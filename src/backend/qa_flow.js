/**
 * Conexión con tu validador SVG y escritura del nuevo status
 */

/**
 * Función que sincroniza los colores de DB_Validator basados en los status de DB_Labels.
 * Se ejecuta de forma optimizada utilizando lecturas y escrituras en bloque (batch).
 */
function updateValidatorColors() {
    Logger.log("🎨 STARTING VALIDATOR COLORS SYNC...");
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // Utilizamos las constantes de configuración globales
    const validatorSheet = ss.getSheetByName(CONFIG.SHEETS.VALIDATOR);
    const labelsSheet = ss.getSheetByName(CONFIG.SHEETS.LABELS);
    
    if (!validatorSheet || !labelsSheet) {
        return Logger.log("❌ Faltan las hojas DB_Validator o DB_Labels");
    }
    
    // --- PASO 1: LEER DB_LABELS Y CREAR MAPA DE BÚSQUEDA RÁPIDA ---
    // Según config.js, DB_Labels tiene: Key | Label
    const ID_COL_LABELS = 0; 
    const STATUS_COL_LABELS = 1; 

    // Obtener los datos desde la fila 2 para saltar encabezados si los hay
    const labelsLastRow = labelsSheet.getLastRow();
    if (labelsLastRow <= 1) {
        return Logger.log("🏁 No hay datos en DB_Labels.");
    }
    
    const labelsData = labelsSheet.getRange(2, 1, labelsLastRow - 1, 2).getValues();
    const labelsMap = {};
    
    for (let i = 0; i < labelsData.length; i++) {
        const ticketId = String(labelsData[i][ID_COL_LABELS]).trim();
        const status = labelsData[i][STATUS_COL_LABELS];
        
        if (ticketId) {
            labelsMap[ticketId] = status;
        }
    }

    // --- PASO 2: LEER DB_VALIDATOR Y PREPARAR COLORES ---
    const validatorLastRow = validatorSheet.getLastRow();
    if (validatorLastRow <= 1) {
        return Logger.log("🏁 No hay datos en DB_Validator.");
    }
    
    // Obtenemos todos los datos y colores desde la fila 2 para respetar los encabezados
    const validatorRange = validatorSheet.getRange(2, 1, validatorLastRow - 1, validatorSheet.getLastColumn());
    const validatorData = validatorRange.getValues();
    const backgrounds = validatorRange.getBackgrounds();
    
    // Según bridge.js, DB_Validator tiene: ['Key', 'Version', 'Platform', 'Status', 'Answer']
    const ID_COL_VALIDATOR = 0; 
    let hasChanges = false;

    for (let i = 0; i < validatorData.length; i++) {
        const ticketId = String(validatorData[i][ID_COL_VALIDATOR]).trim();
        
        // Si el Key es una fórmula HYPERLINK, extraemos solo el texto del ticket.
        // Ej: "=HYPERLINK("url", "CPG-1234")"
        let cleanTicketId = ticketId;
        const match = ticketId.match(/\"([A-Z]+-\d+)\"$/i) || ticketId.match(/([A-Z]+-\d+)/i);
        if (match) {
            cleanTicketId = match[1].toUpperCase();
        }

        let targetColor = null; // null significa que lo dejaremos en blanco

        const status = labelsMap[cleanTicketId]; 
        
        if (status) {
            if (status === 'CPG_QA_APPROVED') {
                targetColor = '#34a853'; // Verde
            } else if (status === 'CPG_QA_ADJUSTMENT') {
                targetColor = '#fbbc04'; // Naranja
            } else if (status === 'CPG_QA_ERROR') {
                targetColor = '#ea4335'; // Rojo
            }
        }

        // Si no hay targetColor (no tiene label o no es uno de los 3), lo ponemos blanco
        if (!targetColor) {
            targetColor = '#ffffff'; 
        }

        // Aplicamos el color (sea el nuevo color o blanco)
        const numCols = backgrounds[i].length;
        for (let col = 0; col < numCols; col++) {
            if (backgrounds[i][col] !== targetColor) {
                backgrounds[i][col] = targetColor;
                hasChanges = true;
            }
        }
    }

    // --- PASO 3: APLICAR TODOS LOS COLORES EN BLOQUE ---
    if (hasChanges) {
        validatorRange.setBackgrounds(backgrounds);
        Logger.log("✅ Colores actualizados correctamente en DB_Validator.");
    } else {
        Logger.log("🏁 No se encontraron cambios de color necesarios.");
    }
}
