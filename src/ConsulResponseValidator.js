'use strict';

const _ = require('lodash');
const InvalidDataError = require('./Error').InvalidDataError;

/**
 * Filters records that have valid format of data. Records that have invalid format will be not be
 * returned back to caller and `errors` array will contain information about format mismatch.
 *
 * Function checks presence of following properties:
 *   - `nodes[n].Key`
 *   - `nodes[n].Value`
 *   - `nodes[n].CreateIndex`
 *   - `nodes[n].Flags`
 *   - `nodes[n].LockIndex`
 *   - `nodes[n].ModifyIndex`
 *
 * @param {*} records - data received from `consul.kv`
 * @returns {{validRecords: Object[], errors: InvalidDataError[]}}
 */
function filterValidKvRecords(records) {
    const data = {validRecords: [], errors: []};

    if (!_.isArray(records)) {
        data.errors.push(new InvalidDataError('Invalid format of data received from consul KV', {records}));

        return data;
    }

    if (_.isEmpty(records)) {
        return data;
    }

    records.forEach(record => {
        if (
            !_.isObject(record) || !_.has(record, 'Key') || !_.has(record, 'Value') ||
            !_.has(record, 'CreateIndex') || !_.has(record, 'Flags') || !_.has(record, 'LockIndex') ||
            !_.has(record, 'ModifyIndex')
        ) {
            data.errors.push(new InvalidDataError('Invalid format of record data received from consul KV', {record}));

            return;
        }


        data.validRecords.push(record);
    });

    return data;
}


module.exports = {
    filterValidKvRecords
};
