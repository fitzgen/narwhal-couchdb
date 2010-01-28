var util = require("util");

var Database = {
    /**
     * List of all documents in the database.
     * 
     * @param {Object} options
     * @returns Rows from the _all_docs query
     * @type Array
     */
    allDocs: function(options){
        var results = [];

        options = options || {};
        options.include_docs = options.include_docs || true;

        this.httpClient.get(this.uri + encodeURIComponent("_all_docs") + encodeOptions(options), {
            async: false,
            success: function(data, textStatus){
                results = data.rows || [];
            },
            error: function(client, textStatus, errorThrown) {
                var msg = client.status + ": " + textStatus;
                if (errorThrown !== undefined) {
                    msg += " " + errorThrown;
                }
                throw new Error(msg);
            }
        });

        return results;
    },
    /**
     * Save a document
     *
     * @param {Object} doc Document to save
     * @param {Boolean} shouldThrow Should raise an exception when fails?
     * @returns true for success, false if shouldThrow is false and the save fails
     * @type Boolean
     */
    save: function(doc, shouldThrow){
        var saved = false;
        if (shouldThrow === undefined){
            shouldThrow = false;
        }

        if (doc._id === undefined) {
            doc._id = this.uuid();
        }

        this.httpClient.put(this.uri + encodeURIComponent(doc._id), {
            data: JSON.stringify(doc),
            async: false,
            success: function(data, statusText){
                doc._id = data.id;
                doc._rev = data.rev;
                saved = true;
            },
            error: function(xhr, textStatus, errorThrown) {
                if (shouldThrow) {
                    throw new Error(xhr.status + ": " + textStatus);
                }
                saved = false;
            }
        });
        
        return saved;
    },
    /**
     * Deletes a document from the database
     *
     * @param {Object} doc Document to remove
     */
    removeDoc: function(doc) {
        var removed = false;

        this.httpClient.del(this.uri + encodeURIComponent(doc._id) + "?rev=" + doc._rev, {
            success: function(data, statusText) {
                removed = true;
            },
            error: function(xhr) {
                removed = false;
                print("ERROR: " + xhr.status);
            }
        });

        return removed;
    },
    /**
     * Bulk save documents with the CouchDB bulk save API
     *
     * Bulk Document API:
     * http://wiki.apache.org/couchdb/HTTP_Bulk_Document_API
     *
     * @param {Object} docs Documents to save
     * @param {Boolean} shouldThrow Should throw an error if fail?
     * @returns True if save succeded, false if shouldThrow is false and bulkSave failed.
     * @type Boolean
     */
    bulkSave: function(docs, shouldThrow){
        var self = this;
        var saved = false;
        var err;

        docs.forEach(function(doc){
            if (doc._id == undefined) {
                doc._id = self.uuid();
            }
        });

        this.httpClient.post(this.uri + "_bulk_docs", {
            async: false,
            data: JSON.stringify({ "docs": docs }),
            success: function(data, textStatus) {
                var doc;
                var i;
                saved = true;
                for (i=0;i<data.length;++i) {
                    doc = docs.filter(function(x) {
                        return x._id === data[i].id;
                    });
                    if (doc && doc.length === 1) {
                        doc = doc[0];
                        doc._rev = data[i].rev;
                    }
                }
            },
            error: function(xhr, textStatus, errorThrown){
                err = { status: xhr.status,
                    textStatus: textStatus,
                    errorThrown: errorThrown
                };
            }
        });

        if (err !== undefined) {
            saved = false;
            if (shouldThrow) {
                throw new Error(err.status + ": " + err.textStatus || "" + err.errorThrown || "");
            }
        }

        return saved;
    },
    _findSingleDoc: function(id) {
        var doc = null,
            err = null;

        this.httpClient.get(this.uri + encodeURIComponent(id), {
            async: false,
            success: function(data, textStatus) {
                doc = data;
            },
            error: function(xhr, textStatus, errorThrown) {
                err = { status: xhr.status, textStatus: textStatus, error: errorThrown };
            }
        });

        if (err != null)
        {
            if (err.status == 404)
                return null;
            throw err;
        }

        return doc;
    },
    _findMultipleDocs: function(ids) {
        var docs = [],
            err;

        this.httpClient.post(this.uri + encodeURIComponent("_all_docs") + encodeOptions({ include_docs: true }), {
            async: false,
            data: JSON.stringify({ "keys" : ids }),
            success: function(data, textStatus) {
                docs = data;
            },
            error: function(xhr, textStatus, errorThrown) {
                err = { status: xhr.status, textStatus: textStatus, error: errorThrown };
            }
        });

        if (err)  {
            if (err.status == 404)
                return null;
            throw err;
        }

        return docs;
    },
    /**
     * Find a document or documents by unique identifier(s)
     * @param {Array|String} idOrArrayOfIds A single id or an array of them
     * @returns a single document or an array of documents 
     */
    find: function(idOrArrayOfIds) {
        if (util.isArrayLike(idOrArrayOfIds)) {
            return this._findMultipleDocs(idOrArrayOfIds);
        }
        else {
            return this._findSingleDoc(idOrArrayOfIds);
        }
    },
    /**
     * Retrieve a CouchDB view
     * 
     * @param designDocName
     * @param viewName
     * @param options
     * @returns An object with 'rows', 'total_rows', and 'etag' properties.
     * 'rows' contains the results of the view.
     * 'total_rows' contains the total number of rows indexed by the view.
     * 'etag' contains the etag generated for the view by CouchDB
     */
    view: function(designDocName, viewName, options) {
        var viewResult;
        var keys;
        var viewPath;
        var verb = "get";

        options = options || {};

        if (options.keys) {
            keys = JSON.stringify({ keys: options.keys });
            delete options.keys;
            verb = "post";
        }

        designDocName = designDocName.replace(/^_design\//g, "");

        var httpClientOptions = {
            async: false,
            data: keys,
            success: function(data, textStatus) {
                viewResult = data;
                viewResult.totalRows = viewResult.total_rows;
            },
            complete: function(xhr, textStatus) {
                var status = xhr.status;
                var etag = xhr.getResponseHeader("Etag");
                print("View Complete, Etag is '" + etag + "'" + " '" + viewName + "'");
                print("Status is '" + status + "'");
                viewResult.status = status;
                
                if (typeof etag === "string") {
                    viewResult.etag = etag;
                }
            },
            error: function(xhr, textStatus, errorThrown) {
                throw new Error(textStatus + ": " + (errorThrown || ""));
            }
        };
        if (typeof options.etag !== "undefined" && options.etag !== null) {
            //if (/^["']/.test(options.etag)) {
            //    options.etag = options.etag.substring(1, options.etag.length - 1);
            //}
            print("adding If-None-Match: " + options.etag);
            httpClientOptions.headers = [{ label: "If-None-Match", value: options.etag }];
            delete options.etag;
        }

        viewPath = this.uri + "_design/" + designDocName + "/_view/" + viewName + encodeOptions(options);

        this.httpClient[verb](viewPath, httpClientOptions);

        return viewResult;
    },
    /**
     * Retrieve a CouchDB list
     *
     * List Reference:
     * http://wiki.apache.org/couchdb/Formatting_with_Show_and_List
     *
     * @param {String} designDocName Name of the design document
     * @param {String} listName Name of the list
     * @param {String} viewName Name of the view to pass to the list
     * @param {Object} options
     * @returns Output of the CouchDB List
     * @type {Object}
     */
    list: function(designDocName, listName, viewName, options){
        var listResult;
        var keys;
        var verb = "get";

        options = options || {};
        if (options.keys) {
            keys = JSON.stringify({ "keys" : options.keys });
            verb = "post";
            delete options.keys;
        }

        var listUri = this.uri + "_design/" + designDocName + "/_list/" + listName + "/" + viewName + encodeOptions(options);
        print("list: " + listUri);

        this.httpClient[verb](listUri, {
            async: false,
            data: keys,
            dataType: "json",
            success: function(data, textStatus) {
                listResult = data;
            },
            error: function(xhr, textStatus, errorThrown){
                throw new Error(textStatus + ": " + (errorThrown || ""));
            }
        });

        return listResult;
    },
    fullTextSearch: function(designDocName, fullTextViewName, options) {
        var operator;

        options = options || {};
        options = util.deepCopy(options);
        options.include_docs = options.include_docs || false;

        if (options.operator) {
            operator = options.operator;
            delete options.operator;
        } else {
            operator = "OR";
        }

        if (options.query) {
            if (typeof options.query === "string") {
                options.q = options.query;
            } else {
                options.q = "";

                for (var key in options.query){
                    if (options.q != "") {
                        options.q += " OR ";
                    }
                    options.q += key + ":" + options.query[key];
                }
            }
            delete options.query;
        }

        var fullTextResult = [];

        var uri = this.uri + "_fti/" + designDocName + "/" + fullTextViewName + encodeOptions(options);
        print(uri);

        this.httpClient.get(uri, {
            async: false,
            dataType: "json",
            success: function(data, textStatus) {
                fullTextResult = data;
            }
        });

        return fullTextResult;
    },
    deleteAttachmentFromDoc: function(doc, attachmentName){

    },
    addAttachmentToDoc: function(doc, attachmentName, contentType, attachmentData) {
        var status;

        if (doc._rev === undefined) {
            throw new Error("Argument 'doc' must have a '_rev' property in order to add attachments.");
        }
        if (attachmentName === undefined || attachmentName === null || attachmentName === ""){
            throw new Error("Argument 'attachmentName' is required");
        }

        var uri = this.uri + doc._id + "/" + attachmentName + "?rev=" + doc._rev;

        this.httpClient.put(uri, {
            headers: [ { "label" : "Content-Type", "value": contentType }],
            data: attachmentData.toArray(),
            binary: true,
            async: false,
            dataType: "json",
            success: function(data, textStatus) {
                status = textStatus;
		 if (!data.ok) {
                    response = false;
                    return status;
                }
            },
            error: function(xhr, textStatus, errorThrown) {
                textStatus = textStatus || "";
                errorThrown = errorThrown || "";
                throw new Error("Failed to add attachment: " + xhr.status + " " + textStatus + " " + errorThrown);
            }
        });

        return status;
    },
    removeAttachmentFromDoc: function(doc, attachmentName) {
        var response = true;

        if (doc._id === undefined) {
            throw new Error("Can not delete attachments from a doc that does not have an id");
        }
        if (doc._rev === undefined) {
            throw new Error("Can not delete attachments from a doc that does not have a revision number");
        }

        var uri = this.uri + doc._id + "/" + attachmentName + "?rev=" + doc._rev;
        this.httpClient.del(uri, {
            async: false,
            dataType: "json",
            success: function(data, textStatus) {
                if (!data.ok) {
                    response = false;
                    return;
                }
                doc._rev = data.rev;
            },
            error: function(xhr) {
                throw new Error("Failed to delete attachment: " + xhr.status);
            }
        });

        return response;
    },
    getAttachment: function(docId, attachmentName, options) {
        var HttpClient = require("couchdb/http_client").HttpClient;
        var httpClient = new HttpClient();
        var url = this.uri + docId + "/" + encodeURIComponent(attachmentName);
        print(url);
        var util = require("util");
        var log = this.log;
        var attachment = {};
        var isError = false;

        httpClient.get(url, {
            dataType: "raw",
            success: function(data) {
                attachment.data = data;
            },
            complete: function(xhr, textStatus) {
                var contentType;
                var etag;

                contentType = xhr.getResponseHeader("Content-Type");
                if (typeof contentType === "string") {
                    attachment.content_type = contentType;
                }

                etag = xhr.getResponseHeader("Etag");
                if (typeof etag === "string") {
                    print(options.if_none_match);
                    print(etag);
                    print("\n");
                    if (options.if_none_match && options.if_none_match === etag) {
                        if (options.not_modified) {
                            options.not_modified();
                            return;
                        }
                    }
                    attachment.etag = etag;
                }

                if (!isError) {
                    if (options.success)
                        options.success(attachment);
                }
            },
            error: function(client, textStatus, errorThrown) {
                if (errorThrown) {
                    print("HttpClient error: " + errorThrown);
                }
                isError = true;
                if (options.error)
                    options.error(textStatus);
            }
        });
    }
};

// from couch.js which is included in CouchDB with apache license
// slightly modified
function encodeOptions(options) {
    var buf = [];
    if (typeof(options) == "object" && options !== null) {
        for (var name in options) {
            if (!options.hasOwnProperty(name)) continue;
            var value = options[name];
            if (name == "key" || name == "startkey" || name == "endkey") {
                value = JSON.stringify(value);
            }
            buf.push(encodeURIComponent(name) + "=" + encodeURIComponent(value));
        }
    }
    if (!buf.length) {
        return "";
    }
    return "?" + buf.join("&");
}

exports.Database = Database;

