/**
 *   ___ _   _ ___ ___  ___  ___ _____ ___ 
 *  / _ \ | | |_ _|   \| _ ) / _ \_   _/ __|
 * |  _  \ V / | || |) | _ \| (_) || | \__ \
 * |_| |_|\_/ |___|___/|___/ \___/ |_| |___/
 *
 * Copyright 2026, Avidbots Corp.
 * @name      backend/main.gs
 * @brief     Main orchestrator. Connects fetching, processing, and database writing.
 */

/**
 * Main Incremental Sync Function.
 * Finds tickets changed in the last 7 days and updates the sheet.
 */
function runIncrementalSync() {
    Logger.log("🚀 STARTING INCREMENTAL SYNC...");

    // 1. Define target tickets (Modified in the last week)
    const jql = `project = "${CONFIG.JIRA.PROJECT}" AND updated >= -7d ORDER BY updated ASC`;

    try {
        // 2. Fetch from Jira
        Logger.log("📡 Connecting to Jira API...");
        const rawIssues = fetchJiraIssues(jql);
        Logger.log(`✅ Downloaded ${rawIssues.length} recent tickets.`);

        if (rawIssues.length === 0) {
            return Logger.log("🏁 No new changes. Sync finished.");
        }

        // 3. Process Data
        Logger.log("⚙️ Processing data and transforming dates...");
        const mainDbRows = Processor.processForMainDB(rawIssues);
        const labelRows = Processor.processForLabelsDB(rawIssues);

        // Get array with just the Keys
        const ticketKeys = mainDbRows.map(row => row[0]);

        // 4. Write to Google Sheets
        Logger.log("💾 Writing to DB_Tickets...");
        const dbResult = Database.upsertTickets(mainDbRows);
        Logger.log(`📝 Tickets Inserted: ${dbResult.inserted} | Updated: ${dbResult.updated}`);

        Logger.log("🏷️ Syncing DB_Labels (QRT)...");
        const labelsWritten = Database.syncLabels(labelRows, ticketKeys);
        Logger.log(`🏷️ Labels processed: ${labelsWritten}`);

        PropertiesService.getScriptProperties().setProperty('LAST_JIRA_SYNC_TIMESTAMP', Utilities.formatDate(new Date(), "America/Bogota", "yyyy-MM-dd HH:mm:ss"));
        Logger.log("🎉 SYNC COMPLETED SUCCESSFULLY.");

    } catch (error) {
        Logger.log("❌ CRITICAL ERROR IN SYNC: " + error.message);
    }
}

/**
 * TOTAL REBUILD (Full Sync)
 * Clears the full database and re-downloads the entire project from Jira.
 */
function runFullRebuild() {
    Logger.log("⚠️ STARTING TOTAL DATABASE REBUILD...");

    try {
        Logger.log("🧹 Clearing current spreadsheets...");
        Database.clearAllData();

        // Extract tickets created after the historical base date for Full Sync
        const historyDate = CONFIG.SYNC.HISTORICAL_DATE || "2025-01-01";
        const jql = `project = "${CONFIG.JIRA.PROJECT}" AND created >= "${historyDate}" ORDER BY created ASC`;

        Logger.log("📡 Connecting to Jira API and downloading the full project...");
        const rawIssues = fetchJiraIssues(jql);
        Logger.log(`✅ Downloaded ${rawIssues.length} tickets in total.`);

        if (rawIssues.length === 0) {
            Logger.log("🏁 No tickets in the project.");
            return "No tickets found in the Jira project.";
        }

        // Process
        Logger.log("⚙️ Processing massive data...");
        const mainDbRows = Processor.processForMainDB(rawIssues);
        const labelRows = Processor.processForLabelsDB(rawIssues);

        // Backup pure keys before upsertTickets converts them to HTML Formulas
        const ticketKeys = mainDbRows.map(row => row[0]);

        // Write to Google Sheets
        Logger.log("💾 Writing all tickets to DB_Tickets...");
        const dbResult = Database.upsertTickets(mainDbRows);

        Logger.log("🏷️ Syncing labels in DB_Labels...");
        const labelsWritten = Database.syncLabels(labelRows, ticketKeys);

        Logger.log("🌉 Regenerating DB_Validator (Bridge)...");
        runValidatorBridge();

        Logger.log("🎨 Syncing Validator Colors...");
        updateValidatorColors();

        Logger.log(`📝 Summary -> Inserted: ${dbResult.inserted} | Labels processed: ${labelsWritten}`);
        PropertiesService.getScriptProperties().setProperty('LAST_JIRA_SYNC_TIMESTAMP', Utilities.formatDate(new Date(), "America/Bogota", "yyyy-MM-dd HH:mm:ss"));
        Logger.log("🎉 REBUILD COMPLETED SUCCESSFULLY.");

        return `Database successfully rebuilt: ${dbResult.inserted} tickets imported.`;

    } catch (error) {
        Logger.log("❌ CRITICAL ERROR IN REBUILD: " + error.message);
        throw error;
    }
}

/**
 * SPECIFIC HISTORICAL LOAD
 * Downloads and updates tickets modified within a date range.
 */
function runHistoricalLoad(startDate, endDate) {
    Logger.log(`⏱️ STARTING HISTORICAL LOAD: ${startDate} to ${endDate}`);

    try {
        // Format JQL: tickets CREATED in this range
        const jql = `project = "${CONFIG.JIRA.PROJECT}" AND created >= "${startDate}" AND created <= "${endDate}" ORDER BY created ASC`;

        Logger.log(`📡 Querying Jira with JQL: ${jql}`);
        const rawIssues = fetchJiraIssues(jql);

        if (rawIssues.length === 0) {
            Logger.log("🏁 No modified tickets found in this date range.");
            return `0 tickets found between ${startDate} and ${endDate}.`;
        }

        Logger.log(`✅ Downloaded ${rawIssues.length} historical tickets. Processing...`);
        const mainDbRows = Processor.processForMainDB(rawIssues);
        const labelRows = Processor.processForLabelsDB(rawIssues);

        // Keep only Keys for Database.syncLabels before upsertTickets converts them
        const ticketKeys = mainDbRows.map(row => row[0]);

        const dbResult = Database.upsertTickets(mainDbRows);
        const labelsWritten = Database.syncLabels(labelRows, ticketKeys);

        Logger.log(`📝 Historical -> Inserted: ${dbResult.inserted} | Updated: ${dbResult.updated} | Labels: ${labelsWritten}`);
        return `Historical Load Completed. Imported/Updated en masse: ${mainDbRows.length} tickets.`;

    } catch (error) {
        Logger.log("❌ ERROR IN HISTORICAL LOAD: " + error.message);
        throw error; // Transmit error to Web App (.withFailureHandler)
    }
}

/**
 * MANUAL UPDATE
 * Forces download and update of specific tickets ignoring dates.
 */
function runManualUpdate(keys) {
    if (!keys || keys.length === 0) return "No tickets provided to update.";

    Logger.log(`🛠️ STARTING MANUAL UPDATE FOR ${keys.length} TICKETS...`);

    try {
        const keysList = keys.map(k => `"${k}"`).join(", ");
        const jql = `project = "${CONFIG.JIRA.PROJECT}" AND key IN (${keysList})`;

        Logger.log(`📡 Querying Jira with JQL: ${jql}`);
        const rawIssues = fetchJiraIssues(jql);

        if (rawIssues.length === 0) {
            Logger.log("🏁 No tickets found with those keys in Jira.");
            return `No ticket was found in Jira with those keys.`;
        }

        Logger.log(`✅ Downloaded ${rawIssues.length} tickets. Processing...`);
        const mainDbRows = Processor.processForMainDB(rawIssues);
        const labelRows = Processor.processForLabelsDB(rawIssues);

        const ticketKeys = mainDbRows.map(row => row[0]);

        const dbResult = Database.upsertTickets(mainDbRows);
        const labelsWritten = Database.syncLabels(labelRows, ticketKeys);

        Logger.log(`📝 Manual -> Inserted: ${dbResult.inserted} | Updated: ${dbResult.updated}`);

        const foundKeys = rawIssues.map(i => i.key);
        const missing = keys.filter(k => !foundKeys.includes(k));
        let exitMsg = `Update of ${rawIssues.length} tickets completed.`;
        if (missing.length > 0) {
            exitMsg += ` WARNING: Not found in Jira: ${missing.join(", ")}`;
        }

        return exitMsg;

    } catch (error) {
        Logger.log("❌ ERROR IN MANUAL UPDATE: " + error.message);
        throw error;
    }
}

/**
 * AUDIT AND DELETED CLEANUP (Deep Sweep)
 * Compares local vs Jira tickets and deletes phantoms.
 */
function runCleanupDeleted() {
    Logger.log("🧹 STARTING TICKET AUDIT AND DEEP SWEEP...");

    try {
        const sheetKeys = Database.getAllTicketKeys();
        if (sheetKeys.length === 0) {
            return "No tickets in Google Sheets to audit.";
        }

        // PHASE 1: Phantom Pruning
        const oldestDate = CONFIG.SYNC.HISTORICAL_DATE || "2025-01-01";
        const jqlKeys = `project = "${CONFIG.JIRA.PROJECT}" AND created >= "${oldestDate}" OR updated >= "2026-01-01" ORDER BY created ASC`;

        Logger.log(`📡 PHASE 1: Getting master keys since ${oldestDate}...`);
        const jiraKeys = fetchJiraKeysOnly(jqlKeys);
        const jiraKeysSet = new Set(jiraKeys);
        const missingInJira = sheetKeys.filter(k => !jiraKeysSet.has(k));

        let deletedGhosts = 0;
        if (missingInJira.length > 0) {
            Logger.log(`🗑️ Detected ${missingInJira.length} deleted tickets in Jira. Removing them from Sheets...`);
            deletedGhosts = Database.deleteTickets(missingInJira);
        } else {
            Logger.log("✅ PHASE 1 OK: No phantom tickets found.");
        }

        // PHASE 2: Deep Sweep (45 days rescue sync for stuck tickets)
        Logger.log("🔍 PHASE 2: Starting Deep Sweep of lost updates from the last 45 days...");
        const deepJql = `project = "${CONFIG.JIRA.PROJECT}" AND updated >= -45d ORDER BY updated ASC`;
        const deepIssues = fetchJiraIssues(deepJql);

        let dbResult = { inserted: 0, updated: 0 };
        if (deepIssues.length > 0) {
            const mainDbRows = Processor.processForMainDB(deepIssues);
            const labelRows = Processor.processForLabelsDB(deepIssues);
            const ticketKeys = mainDbRows.map(row => row[0]);

            dbResult = Database.upsertTickets(mainDbRows);
            Database.syncLabels(labelRows, ticketKeys);
            Logger.log(`🔄 PHASE 2 OK: Deep Sweep processed ${deepIssues.length} tickets (Updated ${dbResult.updated} and Inserted ${dbResult.inserted} stragglers).`);
        }

        return `✅ Audit Finished. 🗑️ Phantom deleted: ${deletedGhosts} | 🔄 Resynced (45d Deep Sweep): ${dbResult.updated + dbResult.inserted}`;

    } catch (error) {
        Logger.log("❌ ERROR IN AUDIT/DEEP SWEEP: " + error.message);
        throw error;
    }
}

/**
 * GENERATES DATA INTEGRITY REPORT
 * Compares Jira keys vs Google Sheets keys and returns statistical indicators.
 */
function runIntegrityReport() {
    Logger.log("📊 GENERATING DATA INTEGRITY REPORT...");

    try {
        const sheetKeys = Database.getAllTicketKeys();
        const oldestDate = CONFIG.SYNC.HISTORICAL_DATE || "2025-01-01";
        const jqlKeys = `project = "${CONFIG.JIRA.PROJECT}" AND created >= "${oldestDate}" ORDER BY created ASC`;

        Logger.log(`📡 Fetching master keys from Jira since ${oldestDate}...`);
        const jiraKeys = fetchJiraKeysOnly(jqlKeys);

        const jiraKeysSet = new Set(jiraKeys.map(k => k.toUpperCase()));
        const sheetKeysSet = new Set(sheetKeys.map(k => k.toUpperCase()));

        // 1. Calculate intersection and differences
        const matchingKeys = [];
        const missingInJira = [];
        const missingInSheets = [];

        sheetKeys.forEach(k => {
            const keyUpper = k.toUpperCase();
            if (jiraKeysSet.has(keyUpper)) {
                matchingKeys.push(k);
            } else {
                missingInJira.push(k); // In Sheets, but not in Jira (Phantoms)
            }
        });

        jiraKeys.forEach(k => {
            const keyUpper = k.toUpperCase();
            if (!sheetKeysSet.has(keyUpper)) {
                missingInSheets.push(k); // In Jira, but not in Sheets (Missing)
            }
        });

        const totalJira = jiraKeys.length;
        const totalSheets = sheetKeys.length;
        const matchCount = matchingKeys.length;

        // Coincidence percentage (how many of Jira's tickets are in Sheets)
        const matchPercentage = totalJira > 0 ? ((matchCount / totalJira) * 100) : (totalSheets === 0 ? 100 : 0);

        return {
            status: "success",
            timestamp: Utilities.formatDate(new Date(), "America/Bogota", "yyyy-MM-dd HH:mm:ss"),
            oldestDate: oldestDate,
            totalJira: totalJira,
            totalSheets: totalSheets,
            matchCount: matchCount,
            matchPercentage: parseFloat(matchPercentage.toFixed(2)),
            missingInJiraCount: missingInJira.length,
            missingInJiraSamples: missingInJira.slice(0, 15), // send first 15 samples
            missingInSheetsCount: missingInSheets.length,
            missingInSheetsSamples: missingInSheets.slice(0, 15), // send first 15 samples
        };

    } catch (error) {
        Logger.log("❌ ERROR GENERATING INTEGRITY REPORT: " + error.message);
        throw error;
    }
}


/**
 * TRIGGERS MANAGER (Automation)
 * Enables or disables scheduled executions in the cloud.
 */
function manageTriggers(enable) {
    Logger.log(`⏱️ TRIGGERS MANAGER: Request to ${enable ? 'ACTIVATE' : 'DEACTIVATE'} automation.`);

    // 1. Strictly clear all previous existing triggers to avoid clones
    const triggers = ScriptApp.getProjectTriggers();
    let deletedCount = 0;
    triggers.forEach(trigger => {
        const handlerName = trigger.getHandlerFunction();
        if (handlerName === 'runIncrementalSync' || handlerName === 'runCleanupDeleted' || handlerName === 'runValidatorBridge' || handlerName === 'updateValidatorColors') {
            ScriptApp.deleteTrigger(trigger);
            deletedCount++;
        }
    });

    if (enable) {
        // 2. Fast Sync: Every 5 minutes
        ScriptApp.newTrigger('runIncrementalSync')
            .timeBased()
            .everyMinutes(5)
            .create();

        // 2.5 Validation Bridge: Every 5 minutes we check Dev Complete
        ScriptApp.newTrigger('runValidatorBridge')
            .timeBased()
            .everyMinutes(5)
            .create();

        // 2.6 Validator Colors Sync: Every 5 minutes
        ScriptApp.newTrigger('updateValidatorColors')
            .timeBased()
            .everyMinutes(5)
            .create();

        // 3. Audit and Cleanup: Every day at Midnight (Colombia local time)
        ScriptApp.newTrigger('runCleanupDeleted')
            .timeBased()
            .atHour(0)
            .everyDays(1)
            .inTimezone(Session.getScriptTimeZone())
            .create();

        Logger.log(`✅ Triggers built. (${deletedCount} old duplicates deleted)`);
        return "▶️ AUTOMATION ENABLED: Sync every 5 min and Cleanup at Midnight.";
    } else {
        Logger.log(`⏸️ Triggers successfully destroyed (${deletedCount} detected).`);
        return "⏸️ AUTOMATION DISABLED: All background processes have been stopped.";
    }
}

/**
 * UNIT TEST: Fetches, processes, and writes a SINGLE TICKET to the spreadsheet.
 * Generates headers if sheets are empty.
 */
function testSingleTicketSync() {
    const ticketKey = "CPG-76870"; // We use your test ticket
    Logger.log(`🧪 STARTING UNIT TEST (End-to-End) WITH: ${ticketKey}`);

    const jql = `key = "${ticketKey}"`;

    try {
        // 1. Extraction
        Logger.log("📡 Downloading ticket from Jira...");
        const rawIssues = fetchJiraIssues(jql);
        if (rawIssues.length === 0) return Logger.log("❌ Ticket not found.");

        // 2. Processing
        Logger.log("⚙️ Processing data and filtering columns...");
        const mainDbRows = Processor.processForMainDB(rawIssues);
        const labelRows = Processor.processForLabelsDB(rawIssues);

        // 3. Writing to Database
        Logger.log("💾 Writing to Google Sheets...");
        const dbResult = Database.upsertTickets(mainDbRows);
        const labelsWritten = Database.syncLabels(labelRows, [ticketKey]);

        // 4. Final Report
        Logger.log("=====================================");
        Logger.log(`✅ TEST RESULT`);
        Logger.log(`📊 DB_Tickets -> Inserted: ${dbResult.inserted} | Updated: ${dbResult.updated}`);
        Logger.log(`🏷️ DB_Labels  -> Labels saved: ${labelsWritten}`);
        Logger.log("=====================================");
        Logger.log("👀 Go to your 'DB_Tickets' and 'DB_Labels' sheets to see the magic.");

    } catch (error) {
        Logger.log("❌ ERROR IN EST: " + error.message);
    }
}