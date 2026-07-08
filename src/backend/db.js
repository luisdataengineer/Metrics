/**
 *   ___ _   _ ___ ___  ___  ___ _____ ___ 
 *  / _ \ | | |_ _|   \| _ ) / _ \_   _/ __|
 * |  _  \ V / | || |) | _ \| (_) || | \__ \
 * |_| |_|\_/ |___|___/|___/ \___/ |_| |___/
 *
 * Copyright 2026, Avidbots Corp.
 * @name      backend/database.gs
 * @brief     Database interaction layer. Handles Upsert operations 
 * and auto-generates 24 headers if missing.
 */

const Database = {

    getOldestTicketDate: function () {
        const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEETS.TICKETS);
        if (!sheet) return null;
        let lastRow = sheet.getLastRow();
        if (lastRow <= 1) return null;

        // Column 15 is 'Created' (TICKETS: A=1... O=15)
        const dates = sheet.getRange(2, 15, lastRow - 1, 1).getValues().flat();
        let oldest = null;

        dates.forEach(d => {
            if (d) {
                const dateObj = new Date(d);
                if (!isNaN(dateObj.getTime())) {
                    if (!oldest || dateObj < oldest) oldest = dateObj;
                }
            }
        });

        if (!oldest) return null;
        return Utilities.formatDate(oldest, "America/Bogota", "yyyy-MM-dd");
    },

    getAllTicketKeys: function () {
        const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEETS.TICKETS);
        if (!sheet) return [];
        const lastRow = sheet.getLastRow();
        if (lastRow <= 1) return [];

        const rawKeys = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
        return rawKeys.map(k => {
            const cellStr = String(k);
            const match = cellStr.match(/([A-Z]+-\d+)/i);
            return match ? match[1].toUpperCase() : cellStr;
        }).filter(k => k.includes("-"));
    },

    deleteTickets: function (keysToDelete) {
        if (!keysToDelete || keysToDelete.length === 0) return 0;

        const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEETS.TICKETS);
        if (!sheet) return 0;

        let lastRow = sheet.getLastRow();
        if (lastRow <= 1) return 0;

        // Bottom-up deletion (Reverse iteration) to prevent row index skipping
        const rawKeys = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
        let deletedCount = 0;

        for (let i = rawKeys.length - 1; i >= 0; i--) {
            const cellValue = String(rawKeys[i]);
            const match = cellValue.match(/([A-Z]+-\d+)/i);
            const key = match ? match[1].toUpperCase() : cellValue;

            if (keysToDelete.includes(key)) {
                sheet.deleteRow(i + 2); // +2 compensates for the header and index 0 of the array
                deletedCount++;
            }
        }

        // Clearing dependent Labels (QRT) sheet
        const labelSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEETS.LABELS);
        if (labelSheet && labelSheet.getLastRow() > 1) {
            const rawLabels = labelSheet.getRange(2, 1, labelSheet.getLastRow() - 1, 1).getValues().flat();
            for (let i = rawLabels.length - 1; i >= 0; i--) {
                const cellStr = String(rawLabels[i]);
                const match = cellStr.match(/([A-Z]+-\d+)/i);
                const lKey = match ? match[1].toUpperCase() : cellStr;
                if (keysToDelete.includes(lKey)) {
                    labelSheet.deleteRow(i + 2);
                }
            }
        }

        return deletedCount;
    },

    clearAllData: function () {
        const ticketSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEETS.TICKETS);
        if (ticketSheet) {
            const lastRow = ticketSheet.getLastRow();
            if (lastRow > 1) {
                // Delete all content except row 1 (headers)
                ticketSheet.getRange(2, 1, lastRow - 1, ticketSheet.getLastColumn()).clearContent();
            }
        }

        const labelSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEETS.LABELS);
        if (labelSheet) {
            const lastRowL = labelSheet.getLastRow();
            if (lastRowL > 1) {
                labelSheet.getRange(2, 1, lastRowL - 1, labelSheet.getLastColumn()).clearContent();
            }
        }

        const validatorSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEETS.VALIDATOR);
        if (validatorSheet) {
            const lastRowV = validatorSheet.getLastRow();
            if (lastRowV > 1) {
                validatorSheet.getRange(2, 1, lastRowV - 1, validatorSheet.getLastColumn()).clearContent();
            }
        }
    },

    upsertTickets: function (newRows) {
        if (!newRows || newRows.length === 0) return { inserted: 0, updated: 0 };

        const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEETS.TICKETS);
        if (!sheet) throw new Error("Could not find sheet: " + CONFIG.SHEETS.TICKETS);

        // Strict 24 columns lock to prevent range errors in Sheets
        const TOTAL_COLUMNS = 24;

        // --- MAGIC: AUTO-HEADERS (24 COLUMNS) ---
        if (sheet.getLastRow() === 0) {
            const headers = [
                'Key', 'Summary', 'Location', 'TicketType', 'Severity', 'Priority',
                'TaskType', 'Status', 'Resolution', 'Platform', 'Robot', 'Reporter',
                'Assigned', 'Region', 'Created', 'Cr_Week', 'AssignedAt', 'StartedAt',
                'ResolvedAt', 'Res_Week', 'Res_Month', 'Logged_Spent', 'Turn_Around', 'Updated'
            ];
            const headerRange = sheet.getRange(1, 1, 1, TOTAL_COLUMNS);
            headerRange.setValues([headers]);
            headerRange.setFontWeight("bold");
            headerRange.setBackground("#f3f3f3");
        }

        let lastRow = sheet.getLastRow();
        let inserted = 0;
        let updated = 0;

        // Read all existing rows from the sheet
        let existingRows = [];
        if (lastRow > 1) {
            const range = sheet.getRange(2, 1, lastRow - 1, TOTAL_COLUMNS);
            const values = range.getValues();
            const formulas = range.getFormulas();

            // Merge formulas and values to preserve HYPERLINK and formatting formulas
            existingRows = values.map((row, r) =>
                row.map((val, c) => formulas[r][c] !== "" ? formulas[r][c] : val)
            );
        }

        // Deduplicate existing rows in memory (using Key as map key)
        const uniqueExistingMap = new Map();
        existingRows.forEach(row => {
            const cellStr = String(row[0] || "").trim();
            const match = cellStr.match(/([A-Z]+-\d+)/i);
            const key = match ? match[1].toUpperCase() : cellStr.toUpperCase();
            if (key && key !== "") {
                uniqueExistingMap.set(key, row);
            }
        });

        // Deduplicate newRows based on ticketKey to prevent pagination duplicate inserts
        const uniqueIncomingMap = new Map();
        newRows.forEach(row => {
            const tk = String(row[0] || "").trim().toUpperCase();
            uniqueIncomingMap.set(tk, row);
        });

        // Merge incoming rows into the existing rows map
        uniqueIncomingMap.forEach((row, ticketKey) => {
            // Replace first column with the link formula for writing
            row[0] = `=HYPERLINK("${CONFIG.JIRA.BROWSE_URL}${ticketKey}", "${ticketKey}")`;

            if (uniqueExistingMap.has(ticketKey)) {
                // UPDATE (overwrite existing entry in the map)
                uniqueExistingMap.set(ticketKey, row);
                updated++;
            } else {
                // INSERT (add new entry to the map)
                uniqueExistingMap.set(ticketKey, row);
                inserted++;
            }
        });

        // Convert merged map back to a flat array
        const finalRows = Array.from(uniqueExistingMap.values());

        // --- MAGIC: SORT BY NUMERIC KEY (Ascending) ---
        finalRows.sort((a, b) => {
            const keyA = String(a[0] || "");
            const keyB = String(b[0] || "");

            // Smartly extract only the ticket number (e.g., "CPG-76870" -> 76870)
            const matchA = keyA.match(/-(\d+)/);
            const matchB = keyB.match(/-(\d+)/);

            const numA = matchA ? parseInt(matchA[1], 10) : 0;
            const numB = matchB ? parseInt(matchB[1], 10) : 0;

            return numA - numB;
        });

        // Clear the sheet range completely (row 2 downwards) to eliminate old data, formats, errors
        if (lastRow > 1) {
            sheet.getRange(2, 1, sheet.getMaxRows() - 1, TOTAL_COLUMNS).clearContent();
        }

        // Expand sheet rows if necessary
        const maxRows = sheet.getMaxRows();
        const requiredRows = finalRows.length + 1; // +1 for the header
        if (requiredRows > maxRows) {
            sheet.insertRowsAfter(maxRows, requiredRows - maxRows);
        }

        // Write the merged, updated, and sorted data in a SINGLE block operation (extremely fast)
        if (finalRows.length > 0) {
            sheet.getRange(2, 1, finalRows.length, TOTAL_COLUMNS).setValues(finalRows);
        }

        return { inserted, updated };
    },

    syncLabels: function (labelRows, ticketKeys) {
        if (!ticketKeys || ticketKeys.length === 0) return 0;

        // Ensure ticketKeys is an array of pure uppercase string keys
        const pureKeys = ticketKeys.map(k => {
            const str = String(k || "");
            const match = str.match(/([A-Z]+-\d+)/i);
            return match ? match[1].toUpperCase() : str.toUpperCase().trim();
        });

        const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEETS.LABELS);
        if (!sheet) throw new Error("Could not find sheet: " + CONFIG.SHEETS.LABELS);

        const TOTAL_COLUMNS = 3;

        // --- MAGIC: QRT AUTO-HEADERS ---
        if (sheet.getLastRow() === 0) {
            const headers = ['Key', 'Main_Label', 'Sub_Label'];
            const headerRange = sheet.getRange(1, 1, 1, TOTAL_COLUMNS);
            headerRange.setValues([headers]);
            headerRange.setFontWeight("bold");
            headerRange.setBackground("#f3f3f3");
        }

        const lastRow = sheet.getLastRow();

        // Apply the hyperlink at the first index ensuring the format
        const processedLabelRows = labelRows.map(row => {
            const rawKey = String(row[0] || "").trim();
            const match = rawKey.match(/([A-Z]+-\d+)/i);
            const tk = match ? match[1].toUpperCase() : rawKey.toUpperCase();
            return [`=HYPERLINK("${CONFIG.JIRA.BROWSE_URL}${tk}", "${tk}")`, row[1], row[2]];
        });

        if (lastRow > 1) {
            const dataRange = sheet.getRange(2, 1, lastRow - 1, TOTAL_COLUMNS);
            const existingData = dataRange.getValues();
            
            // Filter to retain what is not in the current keys AND filter out empty rows
            const dataToKeep = existingData.filter(row => {
                const cellVal = String(row[0] || "").trim();
                if (!cellVal) return false; // Filter out empty rows!

                const match = cellVal.match(/([A-Z]+-\d+)/i);
                const existingKey = match ? match[1].toUpperCase() : cellVal.toUpperCase();

                // Keep only if we are NOT updating this key right now
                return !pureKeys.includes(existingKey);
            });
            
            // Re-convert dataToKeep to a Hyperlink formula
            const restoredDataToKeep = dataToKeep.map(row => {
                const cellVal = String(row[0] || "").trim();
                const match = cellVal.match(/([A-Z]+-\d+)/i);
                const tk = match ? match[1].toUpperCase() : cellVal.toUpperCase();
                return [`=HYPERLINK("${CONFIG.JIRA.BROWSE_URL}${tk}", "${tk}")`, row[1], row[2]];
            });

            const finalData = restoredDataToKeep.concat(processedLabelRows);

            // Clear the full zone completely to eliminate old formats, empty rows, errors
            sheet.getRange(2, 1, sheet.getMaxRows() - 1, TOTAL_COLUMNS).clearContent();

            // Expand sheet rows if necessary
            const maxRows = sheet.getMaxRows();
            const requiredRows = finalData.length + 1;
            if (requiredRows > maxRows) {
                sheet.insertRowsAfter(maxRows, requiredRows - maxRows);
            }

            if (finalData.length > 0) {
                // Re-insert neatly
                sheet.getRange(2, 1, finalData.length, TOTAL_COLUMNS).setValues(finalData);
            }
        } else if (processedLabelRows.length > 0) {
            sheet.getRange(2, 1, processedLabelRows.length, TOTAL_COLUMNS).setValues(processedLabelRows);
        }

        return processedLabelRows.length;
    }
};