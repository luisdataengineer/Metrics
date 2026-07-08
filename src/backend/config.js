/**
 *   ___ _   _ ___ ___  ___  ___ _____ ___ 
 *  / _ \ | | |_ _|   \| _ ) / _ \_   _/ __|
 * |  _  \ V / | || |) | _ \| (_) || | \__ \
 * |_| |_|\_/ |___|___/|___/ \___/ |_| |___/
 *
 * Copyright 2026, Avidbots Corp.
 * @name      backend/config.gs
 * @brief     Global configuration object for the CPG Metrics V2.
 * Contains sheet names, Jira field mappings, and sync settings.
 * @author    Luis N. Espinosa
 */

/**
 * Global Configuration Object
 * Use CONFIG.<CATEGORY>.<PROPERTY> to access values across the project.
 */
const CONFIG = {

    // 1. SPREADSHEET IDENTIFIERS
    // Automatically detects the ID of the sheet where the script is running.
    SPREADSHEET_ID: SpreadsheetApp.getActiveSpreadsheet().getId(),

    // 2. CORE DATABASE SHEETS
    // Names of the tabs as they appear in the Google Sheet.
    SHEETS: {
        TICKETS: "DB_Tickets",  // Main table (27 columns)
        LABELS: "DB_Labels",   // QRT Table (Key | Label)
        VALIDATOR: "DB_Validator", // Commands and validations
        CAPACITY: "Capacity",   // Capacity & Hours tracking
        LOG: "Log"          // Execution and error logs
    },

    // 3. JIRA API SETTINGS
    JIRA: {
        PROJECT: "CPG",
        BROWSE_URL: "https://avidbots.atlassian.net/browse/",
        MAX_RESULTS: 100,

        // Exact fields to be retrieved from Jira API v3.
        // customfield_11625: Typically used for 'Epic Link' or specific CPG metrics.
        FIELDS: [
            "summary",
            "status",
            "resolution",
            "assignee",
            "reporter",
            "created",
            "priority",
            "subtasks",
            "resolutiondate",
            "updated",
            "description",
            "aggregatetimespent",
            "customfield_11625",
            "labels",
            "issuetype"
        ].join(","),

        // Includes transition history to calculate 'Started At' and 'Turn Around Time'.
        EXPAND: "changelog"
    },

    // 4. SYNC & AUTOMATION PROPERTIES
    // These values are often updated dynamically by the script.
    get SYNC() {
        const props = PropertiesService.getScriptProperties();
        return {
            HISTORICAL_DATE: props.getProperty('HISTORICAL_SYNC_DATE') || '2025-01-01',
            LAST_SYNC_TS: props.getProperty('LAST_JIRA_SYNC_TIMESTAMP') || '',
            IS_AUTO_ENABLED: props.getProperty('AUTO_SYNC_ENABLED') === 'true'
        };
    }
};

/**
 * Configuration Diagnostic.
 * Run this to verify the script can access basic spreadsheet info.
 */
function runConfigDiagnostic() {
    Logger.log("--- CONFIG DIAGNOSTIC ---");
    try {
        Logger.log("Active Spreadsheet ID: " + CONFIG.SPREADSHEET_ID);
        Logger.log("Project Scope: " + CONFIG.JIRA.PROJECT);
        Logger.log("Historical Start Date: " + CONFIG.SYNC.HISTORICAL_DATE);

        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const sheetCount = ss.getSheets().length;
        Logger.log("Total Sheets Found: " + sheetCount);

        Logger.log("SUCCESS: Configuration loaded correctly.");
    } catch (e) {
        Logger.log("ERROR: Configuration failed to load. " + e.message);
    }
    Logger.log("-------------------------");
}