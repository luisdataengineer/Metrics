/**
 *   ___ _   _ ___ ___  ___  ___ _____ ___ 
 *  / _ \ | | |_ _|   \| _ ) / _ \_   _/ __|
 * |  _  \ V / | || |) | _ \| (_) || | \__ \
 * |_| |_|\_/ |___|___/|___/ \___/ |_| |___/
 *
 * Copyright 2026, Avidbots Corp.
 * @name      backend/bridge.gs
 * @brief     Bridge logic to extract "Dev Complete" tickets
 * and populate DB_Validator.
 */

function runValidatorBridge() {
    Logger.log("🌉 STARTING VALIDATOR BRIDGE...");

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // 1. Validate base sheets
    const ticketsSheet = ss.getSheetByName(CONFIG.SHEETS.TICKETS);
    const labelsSheet = ss.getSheetByName(CONFIG.SHEETS.LABELS);
    if (!ticketsSheet) {
        return Logger.log("❌ DB_Tickets not found.");
    }

    let validatorSheet = ss.getSheetByName(CONFIG.SHEETS.VALIDATOR);

    // 2. Prepare DB_Validator if empty
    if (!validatorSheet) {
        Logger.log("⚠️ DB_Validator not found. Creating it...");
        validatorSheet = ss.insertSheet(CONFIG.SHEETS.VALIDATOR);
    }

    if (validatorSheet.getLastRow() === 0) {
        const headers = ['Key', 'Summary', 'Assigned', 'Res_Week', 'Version', 'Platform', 'Status', 'Answer', 'Qa'];
        const headerRange = validatorSheet.getRange(1, 1, 1, 9);
        headerRange.setValues([headers]);
        headerRange.setFontWeight("bold");
        headerRange.setBackground("#f3f3f3");
    }

    // 3. Get already processed keys in DB_Validator to avoid repeating calls
    let validatorData = [];
    let validatedKeys = [];
    if (validatorSheet.getLastRow() > 1) {
        validatorData = validatorSheet.getRange(2, 1, validatorSheet.getLastRow() - 1, 9).getValues();
        validatedKeys = validatorData.map(row => {
            const cellStr = String(row[0]);
            const match = cellStr.match(/([A-Z0-9]+-\d+)/i);
            return match ? match[1].toUpperCase() : cellStr;
        }).filter(k => k.includes("-"));
    }

    // 3.5 Load DB_Labels to map Qa labels
    let labelsMap = {};
    if (labelsSheet) {
        const lLastRow = labelsSheet.getLastRow();
        if (lLastRow > 1) {
            const labelsData = labelsSheet.getRange(2, 1, lLastRow - 1, 2).getValues();
            for (let i = 0; i < labelsData.length; i++) {
                const tk = String(labelsData[i][0]).trim();
                const lb = labelsData[i][1];
                if (tk) labelsMap[tk] = lb;
            }
        }
    }

    // 4. Find target tickets in DB_Tickets
    // Columns per processor.js: A=Key(0), B=Summary(1), D=TicketType(3), G=TaskType(6), H=Status(7), M=Assignee(12), T=Res_Week(19)
    const tLastRow = ticketsSheet.getLastRow();
    if (tLastRow <= 1) return Logger.log("🏁 No tickets found in DB_Tickets.");

    const ticketData = ticketsSheet.getRange(2, 1, tLastRow - 1, 20).getValues();
    let rowsToInsert = [];

    Logger.log("🔍 Scanning DB_Tickets for validation candidates...");

    for (let i = 0; i < ticketData.length; i++) {
        const row = ticketData[i];
        const cellStr = String(row[0]);
        const match = cellStr.match(/([A-Z0-9]+-\d+)/i);
        const ticketKey = match ? match[1].toUpperCase() : cellStr;
        
        const summary = String(row[1] || "");
        const ticketType = String(row[3]).toLowerCase();
        const taskType = String(row[6]).toLowerCase();
        const status = String(row[7]).toLowerCase();
        const assigned = String(row[12] || "");
        const resWeek = String(row[19] || "");
        
        const isTargetTaskType = taskType.includes("create") || taskType.includes("edit") || taskType.includes("fix");

        // Condition: Status "dev complete", no parent/epic, and TaskType Create/Edit/Fix
        if (status === "dev complete" && !ticketType.includes("parent") && !ticketType.includes("epic") && isTargetTaskType) {
            // Check if NOT already in validation
            const valIndex = validatedKeys.indexOf(ticketKey);
            if (valIndex === -1) {
                // PROCEED TO PROCESS
                Logger.log(`🎯 Processing new complete ticket: ${ticketKey}`);
                
                // Fetch comments
                const comments = fetchJiraComments(ticketKey);
                
                let extractVersion = "";
                let extractPlatform = "";
                
                // Find last valid URL from newest to oldest comment
                for (let c = comments.length - 1; c >= 0; c--) {
                    const bodyStr = JSON.stringify(comments[c].body || "");
                    
                    // Match command.avidbots, acc.avidbots, or walmart.avidbots
                    const urlMatch = bodyStr.match(/https:\/\/(command|acc|walmart)\.avidbots\.com[^\"]*?#\/plan\/(\d+)\/admin/i);
                    
                    if (urlMatch) {
                        extractPlatform = urlMatch[1].toLowerCase(); 
                        if (extractPlatform === "walmart") extractPlatform = "acc";
                        extractVersion = urlMatch[2];  
                        break; 
                    }
                }

                // Generate Row to insert -> [Key, Summary, Assigned, Res_Week, Version, Platform, Status, Answer, Qa]
                const qaLabel = labelsMap[ticketKey] || "";
                const hyperlink = `=HYPERLINK("${CONFIG.JIRA.BROWSE_URL}${ticketKey}", "${ticketKey}")`;
                rowsToInsert.push([hyperlink, summary, assigned, resWeek, extractVersion, extractPlatform, "", "", qaLabel]);
                
                // Track key to prevent duplicate inserts during the same execution
                validatedKeys.push(ticketKey);

                // Stop execution if we hit the batch limit to prevent Google Apps Script 6-minute timeout
                if (rowsToInsert.length >= 25) {
                    Logger.log("🛑 Batch limit reached (25 tickets). Pausing validator extraction until the next Trigger execution.");
                    break;
                }
            } else {
                // Ticket already exists in DB_Validator. Guarantee data integrity by syncing Summary, Assigned, Res_Week.
                const existingRow = validatorData[valIndex];
                if (existingRow[1] !== summary || existingRow[2] !== assigned || existingRow[3] !== resWeek) {
                    Logger.log(`🔄 Syncing updated info for existing ticket: ${ticketKey}`);
                    // valIndex corresponds to row (valIndex + 2)
                    validatorSheet.getRange(valIndex + 2, 2, 1, 3).setValues([[summary, assigned, resWeek]]);
                    // Update memory array just in case
                    validatorData[valIndex][1] = summary;
                    validatorData[valIndex][2] = assigned;
                    validatorData[valIndex][3] = resWeek;
                }
            }
        }
    }

    // 5. Insert new candidates into DB_Validator
    if (rowsToInsert.length > 0) {
        const lastValRow = validatorSheet.getLastRow();
        const maxValRows = validatorSheet.getMaxRows();
        const needed = lastValRow + rowsToInsert.length;
        if (needed > maxValRows) {
            validatorSheet.insertRowsAfter(maxValRows, needed - maxValRows);
        }
        validatorSheet.getRange(lastValRow + 1, 1, rowsToInsert.length, 9).setValues(rowsToInsert);
        Logger.log(`✅ Bridge Completed: Inserted ${rowsToInsert.length} tickets into DB_Validator.`);
    } else {
        Logger.log("🏁 Bridge Completed: No new tickets to send to DB_Validator.");
    }

    // 6. --- SORT DB_VALIDATOR (Ascending) ---
    const lastValRow = validatorSheet.getLastRow();
    if (lastValRow > 1) {
        const range = validatorSheet.getRange(2, 1, lastValRow - 1, 9);
        const values = range.getValues();
        const formulas = range.getFormulas();
        
        // Re-merge formulas with values (to keep HYPERLINK)
        const merged = values.map((r, rIdx) => 
            r.map((val, cIdx) => formulas[rIdx][cIdx] !== "" ? formulas[rIdx][cIdx] : val)
        );
        
        merged.sort((a, b) => {
            const keyA = String(a[0] || "");
            const keyB = String(b[0] || "");
            
            const matchA = keyA.match(/-(\d+)/);
            const matchB = keyB.match(/-(\d+)/);
            
            const numA = matchA ? parseInt(matchA[1], 10) : 0;
            const numB = matchB ? parseInt(matchB[1], 10) : 0;
            
            return numA - numB;
        });
        
        range.setValues(merged);
        Logger.log("🗂️ DB_Validator ordered successfully ascending.");
    }
}
