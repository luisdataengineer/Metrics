/**
 * SURGICAL TEST (Anti-Matryoshka Version)
 */
function runSingleTicketTest() {
    const ticketKey = "CPG-76869";
    const jql = `key = "${ticketKey}"`;

    try {
        Logger.log(`🔍 Searching for ticket: ${ticketKey}...`);
        const rawIssues = fetchJiraIssues(jql);

        if (!rawIssues || rawIssues.length === 0) {
            return Logger.log(`❌ Ticket not found.`);
        }

        const dbRows = Processor.processForMainDB(rawIssues);

        // THE GREAT TRICK: Flatten to the bottom to destroy extra boxes
        // Converts [[[Data1, Data2]]] into a simple [Data1, Data2]
        let ticketData = dbRows.flat(Infinity);

        // If your old code sneaked in and returned headers at the beginning, we skip them
        if (ticketData.toString().toLowerCase() === "key") {
            ticketData = ticketData.slice(24);
        }

        Logger.log("=========================================");
        Logger.log(`🎟️ EXACT RADIOGRAPHY: ${ticketKey}`);
        Logger.log("=========================================");

        const colNames = [
            'Key', 'Summary', 'Location', 'TicketType', 'Severity', 'Priority',
            'TaskType', 'Status', 'Resolution', 'Platform', 'Robot', 'Reporter',
            'Assigned', 'Region', 'Created', 'Cr_Week', 'AssignedAt', 'StartedAt',
            'ResolvedAt', 'Res_Week', 'Res_Month', 'Logged_Spent', 'Turn_Around', 'Updated'
        ];

        colNames.forEach((name, i) => {
            let value = ticketData[i];
            if (value === null || value === "" || value === undefined) value = "[EMPTY]";
            Logger.log(`${(i + 1).toString().padStart(2, '0')}. ${name.padEnd(15)} : ${value}`);
        });

        Logger.log("=========================================");

        // The same for QRT: Destroy the extra boxes
        const labelRows = Processor.processForLabelsDB(rawIssues);
        const flatLabels = labelRows.flat(Infinity);

        if (flatLabels.length > 0) {
            Logger.log(`🏷️ QRT LABELS:`);
            // Since we flattened the matrix, now the data comes in pairs (Key, Label, Key, Label)
            for (let i = 0; i < flatLabels.length; i += 2) {
                Logger.log(`   -> ${flatLabels[i]} | ${flatLabels[i + 1]}`);
            }
        } else {
            Logger.log("🏷️ QRT LABELS: [NONE FOUND]");
        }
        Logger.log("=========================================");

    } catch (e) {
        Logger.log(`❌ ERROR: ${e.message}`);
    }
}