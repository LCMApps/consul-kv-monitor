'use strict';

class ConsulKvData {
    /**
     * Set records to the map
     *
     * @param {Array} records
     */
    constructor(records) {
        this._kvMap = new Map(records);
    }

    /**
     * @param {String} key
     * @returns {Boolean}
     */
    hasKey(key) {
        return this._kvMap.has(key);
    }

    /**
     * Get all keys from map
     *
     * @returns {String[]}
     */
    getKeys() {
        return Array.from(this._kvMap.keys());
    }

    /**
     * Get saved value from KV
     *
     * @param {String} key
     * @returns {*}
     */
    getValue(key) {
        if (!this._kvMap.has(key)) {
            return undefined;
        }

        return this._kvMap.get(key).value;
    }

    /**
     * Get metadata of record
     *
     * @param {String} key
     * @returns {*}
     */
    getMetadata(key) {
        if (!this._kvMap.has(key)) {
            return undefined;
        }

        return this._kvMap.get(key).metaData;
    }
}

module.exports = ConsulKvData;
