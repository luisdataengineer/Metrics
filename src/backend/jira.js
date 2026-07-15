/**
 *   ___ _   _ ___ ___  ___  ___ _____ ___ 
 *  / _ \ | | |_ _|   \| _ ) / _ \_   _/ __|
 * |  _  \ V / | || |) | _ \| (_) || | \__ \
 * |_| |_|\_/ |___|___/|___/ \___/ |_| |___/
 *
 * Copyright 2026, Avidbots Corp.
 * @name      backend/jira.gs
 * @brief     Jira Integration Layer. Handles authentication, 
 * paginated data extraction, and JQL execution.
 * @author    Luis N. Espinosa
 */

/**
 * Retrieves Jira authentication credentials and basic headers.
 * @returns {Object} {url, headers}
 */
function getJiraAuth() {
    const p = PropertiesService.getScriptProperties();
    const user = p.getProperty('JIRA_USER');
    const token = p.getProperty('JIRA_API_TOKEN');
    const url = p.getProperty('JIRA_BASE_URL');

    if (!user || !token || !url) {
        throw new Error('MISSING_CREDENTIALS: Check JIRA_USER, JIRA_API_TOKEN, and JIRA_BASE_URL in Script Properties.');
    }

    const authHeader = "Basic " + Utilities.base64Encode(user + ":" + token);

    return {
        url: url.replace(/\/+$/, ""),
        headers: {
            "Authorization": authHeader,
            "Accept": "application/json"
        }
    };
}

/**
 * FAST FETCH: Retrieves Keys for ultra-fast audit processes.
 * Includes id and summary to ensure Jira Cloud nextPageToken stability.
 */
function fetchJiraKeysOnly(jqlQuery) {
    const auth = getJiraAuth();
    let allKeys = [];
    let nextPageToken = null;
    let isLastPage = false;
    
    // Retry configuration similar to fetchJiraIssues
    const MAX_RETRIES = 3;

    const options = { method: "get", headers: auth.headers, muteHttpExceptions: true };

    try {
        do {
            // Request id, key, and summary to prevent premature isLast: true and token loss
            let url = `${auth.url}/rest/api/3/search/jql?jql=${encodeURIComponent(jqlQuery)}&fields=id,key,summary&maxResults=${CONFIG.JIRA.MAX_RESULTS || 100}`;
            
            if (nextPageToken) {
                url += "&nextPageToken=" + encodeURIComponent(nextPageToken);
            }

            let attempt = 0, success = false;
            let response, responseCode, responseText;

            while (attempt < MAX_RETRIES && !success) {
                if (attempt > 0) {
                    const sleepTimeMs = Math.pow(2, attempt) * 1000;
                    Logger.log(`Waiting ${sleepTimeMs}ms before retry ${attempt}/${MAX_RETRIES}...`);
                    Utilities.sleep(sleepTimeMs);
                }
                
                try {
                    response = UrlFetchApp.fetch(url, options);
                    responseCode = response.getResponseCode();
                    responseText = response.getContentText();

                    if (responseCode === 200) {
                        success = true;
                    } else if (responseCode === 429) {
                        Logger.log("WARNING: Jira Rate Limit reached (Error 429).");
                        attempt++;
                        if (attempt >= MAX_RETRIES) throw new Error("Jira API Error 429: Rate Limit Exceeded.");
                    } else {
                        throw new Error(`Jira API Error ${responseCode}: ${responseText}`);
                    }
                } catch (e) {
                    Logger.log(`Network/Fetch error on attempt ${attempt + 1}: ${e.message}`);
                    attempt++;
                    if (attempt >= MAX_RETRIES) throw new Error(`Jira API Error: ${e.message}`);
                }
            }

            const data = JSON.parse(responseText);
            let issuesPage = [];
            
            if (data.issues && Array.isArray(data.issues)) {
                issuesPage = data.issues;
            } else if (Array.isArray(data)) {
                issuesPage = data;
            }

            if (issuesPage.length > 0) {
                allKeys = allKeys.concat(issuesPage.map(i => i.key));
            }

            // Safely terminate if token is missing or issues array is empty
            isLastPage = data.isLast === true || !data.nextPageToken || issuesPage.length === 0;
            nextPageToken = data.nextPageToken;

        } while (!isLastPage && nextPageToken);

        return allKeys;
    } catch (e) {
        Logger.log("CRITICAL_ERROR in fetchJiraKeysOnly: " + e.message);
        throw e;
    }
}

/**
 * Main Extraction Engine. Performs paginated GET requests to Jira API v3.
 * Supports the modern nextPageToken pagination and dynamic JQL.
 * Includes Automatic Retries with Exponential Backoff for Rate Limiting.
 *
 * @param {string} jqlQuery - The JQL string to filter issues.
 * @returns {Array} A flat array of Jira issue objects.
 */
function fetchJiraIssues(jqlQuery) {
    const auth = getJiraAuth();
    let allIssues = [];
    let nextPageToken = null;
    let isLastPage = false;
    
    // Retry configuration
    const MAX_RETRIES = 3;

    const options = {
        method: "get",
        headers: auth.headers,
        muteHttpExceptions: true
    };

    try {
        do {
            // 1. Build the Request URL
            let url = auth.url + "/rest/api/3/search/jql?" +
                "jql=" + encodeURIComponent(jqlQuery) +
                "&fields=" + encodeURIComponent(CONFIG.JIRA.FIELDS) +
                "&expand=" + encodeURIComponent(CONFIG.JIRA.EXPAND) +
                "&maxResults=" + CONFIG.JIRA.MAX_RESULTS;

            if (nextPageToken) {
                url += "&nextPageToken=" + encodeURIComponent(nextPageToken);
            }

            // 2. Fetch with Retry Logic
            let responseCode, responseText, response;
            let attempt = 0;
            let success = false;

            while (attempt < MAX_RETRIES && !success) {
                if (attempt > 0) {
                    // Exponential backoff during a retry
                    const sleepTimeMs = Math.pow(2, attempt) * 1000;
                    Logger.log(`Waiting ${sleepTimeMs}ms before retry ${attempt}/${MAX_RETRIES}...`);
                    Utilities.sleep(sleepTimeMs);
                }

                try {
                    response = UrlFetchApp.fetch(url, options);
                    responseCode = response.getResponseCode();
                    responseText = response.getContentText();

                    if (responseCode === 200) {
                        success = true;
                    } else if (responseCode === 429) {
                        // 429: Too Many Requests (Jira Rate Limit)
                        Logger.log("WARNING: Jira Rate Limit reached (Error 429).");
                        attempt++;
                        if (attempt >= MAX_RETRIES) {
                            throw new Error(`Jira API Error 429: Request Limit Exceeded after ${MAX_RETRIES} attempts.`);
                        }
                    } else {
                        // Other failures (401, 400, 500) break immediately
                        throw new Error(`Jira API Error ${responseCode}: ${responseText}`);
                    }
                } catch (e) {
                    Logger.log(`Network/Fetch error on attempt ${attempt + 1}: ${e.message}`);
                    attempt++;
                    if (attempt >= MAX_RETRIES) {
                        throw new Error(`Jira API Error: ${e.message} after ${MAX_RETRIES} attempts.`);
                    }
                }
            }

            // 3. Handle data structure (Safe-mapping for V3)
            const data = JSON.parse(responseText);
            let issuesPage = [];
            
            if (data.issues && Array.isArray(data.issues)) {
                issuesPage = data.issues;
            } else if (Array.isArray(data)) {
                issuesPage = data;
            }

            // 4. Flatten and Store
            if (issuesPage.length > 0) {
                // Using concat is safer to avoid 'call stack' issues seen with .push(...array)
                allIssues = allIssues.concat(issuesPage);
            }

            // 5. Update Pagination State
            isLastPage = data.isLast === true || (!data.nextPageToken && !data.issues);
            nextPageToken = data.nextPageToken;

        } while (!isLastPage && (nextPageToken || isLastPage === false));

        return allIssues;

    } catch (error) {
        Logger.log("CRITICAL_ERROR in fetchJiraIssues: " + error.message);
        throw error;
    }
}

/**
 * Development Test Utility. Simulates a fast synchronization request.
 */
function runJiraDiagnostic() {
    const testJql = "project = '" + CONFIG.JIRA.PROJECT + "' AND updated >= -7d ORDER BY updated DESC";

    Logger.log("--- STARTING JIRA DIAGNOSTIC ---");
    try {
        const rawData = fetchJiraIssues(testJql);
        Logger.log("TOTAL_ISSUES_RECEIVED: " + rawData.length);

        if (rawData.length > 0) {
            // Diagnostic check for the first item
            const firstItem = rawData[0]; 
            const key = firstItem.key || "N/A";
            const summary = (firstItem.fields && firstItem.fields.summary) ? firstItem.fields.summary : "No Summary Found";

            Logger.log("SAMPLE_TICKET: [" + key + "] " + summary);

            // Verification of array flattening
            if (Array.isArray(firstItem)) {
                Logger.log("WARNING: Data is still nested. Check flattening logic.");
            } else {
                Logger.log("SUCCESS: Data structure is flat and ready for processing.");
            }
        }
    } catch (e) {
        Logger.log("DIAGNOSTIC_FAILED: " + e.message);
    }
    Logger.log("--- END OF DIAGNOSTIC ---");
}

/**
 * Fetches comments for a specific issue ID or Key.
 *
 * @param {string} ticketKey - The Jira issue Key (e.g., CPG-12345).
 * @returns {Array} An array of comment objects.
 */
function fetchJiraComments(ticketKey) {
    const auth = getJiraAuth();
    // Jira API v3 comments endpoint
    const url = auth.url + `/rest/api/3/issue/${ticketKey}/comment`;

    const options = {
        method: "get",
        headers: auth.headers,
        muteHttpExceptions: true
    };

    try {
        const response = UrlFetchApp.fetch(url, options);
        const responseCode = response.getResponseCode();
        const responseText = response.getContentText();

        if (responseCode === 200) {
            const data = JSON.parse(responseText);
            return data.comments || [];
        } else {
            Logger.log(`Warning: Failed to fetch comments for ${ticketKey}. Code: ${responseCode}`);
            return [];
        }
    } catch (e) {
        Logger.log(`Error fetching comments for ${ticketKey}: ${e.message}`);
        return [];
    }
}