/**
 * @name      backend/webapp.gs
 * @brief     Entry point for the Apps Script Web App (Dashboard).
 */

/**
 * Required by Google Apps Script to serve web pages (Web Apps).
 * When you open the app URL, this function loads and returns your index.html.
 */
function doGet(e) {
    let template;
    const pathsToTry = ['src/frontend/index', 'frontend/index', 'index'];
    
    for (const path of pathsToTry) {
        try {
            template = HtmlService.createTemplateFromFile(path);
            break;
        } catch (err) {
            // Silently try the next structure
        }
    }
    
    if (!template) {
        return HtmlService.createHtmlOutput("<h2 style='font-family:sans-serif;'>Error 500: Dashboard index.html not found. Check clasp push.</h2>");
    }
    
    return template.evaluate()
        .setTitle('CPG Metrics Manager')
        .setSandboxMode(HtmlService.SandboxMode.IFRAME)
        .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

/**
 * Allows separating CSS and JS into other HTML files.
 * Called from HTML like <?!= include('file'); ?>
 */
function include(filename) {
    const pathsToTry = [filename, filename.replace('src/', ''), filename.replace('src/frontend/', '')];
    
    for (const path of pathsToTry) {
        try {
            return HtmlService.createHtmlOutputFromFile(path).getContent();
        } catch (e) {
            // Try next
        }
    }
    return ''; // Prevents a full crash in case it fails including styles/scripts
}

// =====================================================================
// EXPORTED FUNCTIONS TO WEB INTERFACE (google.script.run)
// =====================================================================

function quickSync() {
    Logger.log("Web App requested: quickSync()");
    // This function exists in your backend (main.js)
    runIncrementalSync(); 
    return "Incremental sync executed successfully. Check the Log for full details.";
}

function rebuildDatabase() {
    Logger.log("Web App requested: rebuildDatabase()");
    return runFullRebuild();
}

function historicalLoad(start, end) {
    Logger.log(`Web App requested: historicalLoad(${start}, ${end})`);
    return runHistoricalLoad(start, end);
}

function manualUpdate(keys) {
    Logger.log(`Web App requested: manualUpdate(${keys.join(', ')})`);
    return runManualUpdate(keys);
}

function cleanupDeleted() {
    Logger.log("Web App requested: cleanupDeleted()");
    return runCleanupDeleted();
}

function toggleTriggers(status) {
    Logger.log(`Web App requested: toggleTriggers(${status})`);
    return manageTriggers(status);
}
