/**
 *   ___ _   _ ___ ___  ___  ___ _____ ___ 
 *  / _ \ | | |_ _|   \| _ ) / _ \_   _/ __|
 * |  _  \ V / | || |) | _ \| (_) || | \__ \
 * |_| |_|\_/ |___|___/|___/ \___/ |_| |___/
 *
 * Copyright 2026, Avidbots Corp.
 * @name      backend/processor.gs
 * @brief     Logic layer for data transformation. Handles JQL to Sheet 
 * mapping, date formatting, and ticket classification.
 * @author    Luis N. Espinosa
 */

const Processor = {

    REGIONS: {
        COLOMBIA: ["Maria Monsalve", "Santiago Martinez Loaiza", "Sebastian Echeverry", "Juan Jose Mosquera Esquivel"],
        INDIA: ["Satya Menda", "Bipin Tripathi", "Siddhantika Paul", "Jayesh Dhawale", "Saran Srigakolapu", "Vn Srikar Kethineni", "Surya Nandi", "Ajai K"]
    },

    ALLOWED_QRT_LABELS: new Set([
        'CPG_QA_APPROVED', 'CPG_QA_ADJUSTMENT', 'CPG_QA_ERROR', 'cpg_qa_sectors_adjustment', 'cpg_qa_sectors_error',
        'cpg_qa_end_vector_adjustment', 'cpg_qa_end_vector_error', 'cpg_qa_start_vector_adjustment', 'cpg_qa_start_vector_error',
        'cpg_qa_annotations_adjustment', 'cpg_qa_annotations_error', 'cpg_qa_glass_walls_adjustment', 'cpg_qa_glass_walls_error',
        'cpg_qa_no_go_zones_adjustment', 'cpg_qa_no_go_zones_error', 'cpg_qa_movable_obstacles_adjustment', 'cpg_qa_movable_obstacles_error',
        'cpg_qa_cloudpointed_zones_adjustment', 'cpg_qa_cloudpointed_zones_error', 'cpg_qa_static_features_adjustment', 'cpg_qa_static_features_error',
        'cpg_qa_no_scrub_zone_adjustment', 'cpg_qa_no_scrub_zone_error', 'cpg_qa_slown_down_zone_adjustment', 'cpg_qa_slown_down_zone_error',
        'cpg_qa_real_room_adjustment', 'cpg_qa_real_room_error', 'cpg_qa_original_map_adjustment', 'cpg_qa_original_map_error',
        'cpg_qa_cleaned_area_adjustment', 'cpg_qa_cleaned_area_error', 'cpg_qa_crop_box_adjustment', 'cpg_qa_crop_box_error',
        'cpg_qa_plan_image_adjustment', 'cpg_qa_plan_image_error', 'cpg_qa_coverage_adjustment', 'cpg_qa_coverage_error',
        'cpg_qa_metadata_adjustment', 'cpg_qa_metadata_error', 'cpg_qa_upload_files_adjustment', 'cpg_qa_upload_files_error',
        'cpg_qa_dnf_instructions', 'cpg_qa_wrong_layer_error'
    ]),

    processForMainDB: function (issues) {
        if (!issues || issues.length === 0) return [];

        return issues.map(issue => {
            const f = issue.fields || {};

            const summary = f.summary || "";
            const reporter = this._normalize(f.reporter?.displayName);
            const labels = f.labels || [];

            // Execute parsing logic
            const descText = this._extractDescription(f.description);
            const location = this._extractLocation(descText);
            const { taskType, platform, robot } = this._classify(summary, reporter, labels, descText);

            let severity = f.customfield_11625?.value || "Unknown";
            if (taskType === "Fix" && severity === "Unknown") severity = "S3";

            const createdObj = new Date(f.created);
            const updatedObj = new Date(f.updated);
            const resolvedObj = this._getResolvedAt(issue);

            const [assignee, assignedAtObj] = this._getAssigneeInfo(issue, createdObj);
            const startedAtObj = this._getStartedAt(issue);

            return [
                issue.key,
                summary,
                location,
                f.subtasks?.length > 0 ? "Parent" : "Ticket",
                severity,
                f.priority?.name || "",
                taskType,
                f.status?.name || "",
                f.resolution?.name || null,
                platform,
                robot,
                reporter,
                this._normalize(assignee),
                this._getRegion(this._normalize(assignee)),
                this._formatDate(createdObj),
                this._getYearWeek(createdObj),
                this._formatDate(assignedAtObj),
                this._formatDate(startedAtObj),
                this._formatDate(resolvedObj),
                this._getYearWeek(resolvedObj),
                resolvedObj ? Utilities.formatDate(resolvedObj, "America/Bogota", "yyyy-MM-01") : null,
                f.aggregatetimespent ? parseFloat((f.aggregatetimespent / 3600).toFixed(2)) : null,
                this._diffDays(createdObj, resolvedObj),
                this._formatDate(updatedObj)
            ];
        });
    },

    processForLabelsDB: function (issues) {
        const rows = [];
        issues.forEach(issue => {
            const labels = issue.fields?.labels || [];
            
            // 1. Filter using the ALLOWED Set for primary safety
            const validLabels = labels.filter(l => this.ALLOWED_QRT_LABELS.has(l));
            
            // 2. Separate Main Labels (uppercase) and Sub Labels (lowercase)
            const mainLabels = validLabels.filter(l => l.startsWith('CPG_QA_') && l === l.toUpperCase());
            const subLabels = validLabels.filter(l => l.startsWith('cpg_qa_') && l === l.toLowerCase());
            
            if (mainLabels.length > 0) {
                mainLabels.forEach(mainLabel => {
                    const suffix = mainLabel === 'CPG_QA_ERROR' ? '_error' 
                                 : mainLabel === 'CPG_QA_ADJUSTMENT' ? '_adjustment' 
                                 : '';

                    let foundSubLabels = [];
                    if (suffix) {
                        foundSubLabels = subLabels.filter(sub => sub.endsWith(suffix));
                    }
                    
                    if (foundSubLabels.length > 0) {
                        foundSubLabels.forEach(sub => {
                            rows.push([issue.key, mainLabel, sub]);
                        });
                    } else {
                        rows.push([issue.key, mainLabel, "None"]);
                    }
                });
            } else if (subLabels.length > 0) {
                // Rare case: There is a subLabel without MainLabel
                subLabels.forEach(sub => {
                    const inferredMain = sub.endsWith('_error') ? 'CPG_QA_ERROR' 
                                       : sub.endsWith('_adjustment') ? 'CPG_QA_ADJUSTMENT' 
                                       : 'CPG_QA_UNKNOWN';
                    rows.push([issue.key, inferredMain, sub]);
                });
            }
        });
        return rows;
    },

    // ======================================================================================
    // OPTIMIZED EXTRACTION AND CLASSIFICATION METHODS
    // ======================================================================================

    _extractDescription: function (descriptionField) {
        if (!descriptionField) return "";
        if (typeof descriptionField === 'string') return descriptionField;
        if (typeof descriptionField === 'object' && descriptionField.content) {
            let fullText = "";
            for (const contentBlock of descriptionField.content) {
                if (contentBlock.content) {
                    for (const textElement of contentBlock.content) {
                        if (textElement.text) fullText += textElement.text + "\n";
                    }
                }
            }
            return fullText.trim();
        }
        return "";
    },

    _extractLocation: function (description) {
        if (!description) return "Unknown";
        const match = String(description).match(/location:\s*(.+)/i);
        if (!match || !match) return "Unknown";

        // Clean arrays and multiple asterisks safely
        let loc = match[1]
            .replace(/\[\+?|\|https?:\/\/[^\]]+\]|\*/g, '')
            .replace(/\+$/, '')
            .trim();

        // Safe cleaner for duplicates (e.g. "Demo,Demo" -> "Demo")
        const parts = loc.split(",");
        if (parts.length === 2 && parts[0].trim() === parts[1].trim()) {
            loc = parts[0].trim();
        }

        return loc;
    },

    _classify: function (summary, reporter, labels, description) {
        const summaryLower = summary ? String(summary).toLowerCase() : "";
        const platform = summaryLower.includes("walmart") ? "Wacc" : "Acc";

        let robot = "Neo"; // Default
        if (summaryLower.includes("kas") || summaryLower.includes("ka1-")) {
            robot = "Kas";
        }

        if (description) {
            const descStr = String(description);
            const match = descStr.match(/Robot[\W_]*([A-Za-z0-9\-]+)/i);

            // Exact match
            if (match && match) {
                const serial = match[1].toUpperCase().trim();
                if (/\d/.test(serial)) {
                    robot = serial.startsWith("KA1") ? "Kas" : "Neo";
                }
            } else if (/\bKA1[-]\d+/i.test(descStr)) {
                robot = "Kas";
            }
        }

        // --- TASK TYPE LOGIC ---
        if (labels && labels.includes("cpg_no_count")) {
            return { taskType: "Admin", platform, robot };
        }

        const hasEdit = /\bedit\b/.test(summaryLower);
        const hasUpdate = /\bupdate\b/.test(summaryLower);
        const hasCreate = /\bcreate\b/.test(summaryLower);
        const isNotAvidbots = reporter !== "Avidbots Manage";

        if ((hasEdit || hasUpdate) && isNotAvidbots) {
            return { taskType: "Edit", platform, robot };
        } else if (hasCreate) {
            return { taskType: "Create", platform, robot };
        } else if (summaryLower.includes("neo") || summaryLower.includes("ka1-") || reporter === "Avidbots Manage") {
            return { taskType: "Fix", platform, robot };
        }

        return { taskType: "Other", platform, robot };
    },

    // ======================================================================================
    // UTILITY METHODS
    // ======================================================================================

    _normalize: function (name) {
        if (!name || name === "Unassigned") return "Unassigned";
        return name.toLowerCase().split(/[\s.]+/)
            .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    },

    _formatDate: function (date) {
        if (!date || isNaN(date.getTime())) return null;
        return Utilities.formatDate(date, "America/Bogota", "yyyy-MM-dd HH:mm:ss");
    },

    _getYearWeek: function (d) {
        if (!d || isNaN(d.getTime())) return null;
        return Utilities.formatDate(d, "America/Bogota", "YYYY-'W'ww");
    },

    _diffDays: function (start, end) {
        if (!start || !end) return null;
        return parseFloat(((end - start) / 86400000).toFixed(2));
    },

    _getRegion: function (name) {
        if (this.REGIONS.COLOMBIA.includes(name)) return "Colombia";
        if (this.REGIONS.INDIA.includes(name)) return "India";
        return "Unknown";
    },

    _getAssigneeInfo: function (issue, created) {
        const histories = issue.changelog?.histories || [];
        let lastUser = issue.fields?.assignee?.displayName || "Unassigned";
        let lastDate = null;
        histories.forEach(h => {
            h.items.forEach(item => {
                if (item.field === "assignee") {
                    const d = new Date(h.created);
                    if (!lastDate || d > lastDate) {
                        lastDate = d;
                        lastUser = item.toString || "Unassigned";
                    }
                }
            });
        });
        return [lastUser, lastDate || created];
    },

    _getStartedAt: function (issue) {
        const histories = issue.changelog?.histories || [];
        const sortedHistories = [...histories].sort((a, b) => new Date(a.created) - new Date(b.created));
        for (let h of sortedHistories) {
            const match = h.items.find(item =>
                item.field === "status" && ["In Progress", "Dev Complete", "Closed", "Done", "Resolved"].includes(item.toString)
            );
            if (match) return new Date(h.created);
        }
        
        const status = issue.fields?.status?.name;
        if (status && ["In Progress", "Dev Complete", "Closed", "Done", "Resolved"].includes(status)) {
            return new Date(issue.fields.created);
        }
        return null;
    },

    _getResolvedAt: function (issue) {
        if (issue.fields?.resolutiondate) {
            return new Date(issue.fields.resolutiondate);
        }
        
        const status = issue.fields?.status?.name;
        if (status && ["Dev Complete", "Closed", "Done", "Resolved"].includes(status)) {
            const histories = issue.changelog?.histories || [];
            const sortedHistories = [...histories].sort((a, b) => new Date(b.created) - new Date(a.created));
            for (let h of sortedHistories) {
                const match = h.items.find(item => item.field === "status" && ["Dev Complete", "Closed", "Done", "Resolved"].includes(item.toString));
                if (match) return new Date(h.created);
            }
            return new Date(issue.fields.updated);
        }
        return null;
    }
};