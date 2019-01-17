'use strict';

const InvalidDataError = require('./Error').InvalidDataError;
const ConsulKvData = require('./ConsulKvData');
const ConsulResponseValidator = require('./ConsulResponseValidator');

/**
 * Function receives path of the key which was read and body of response. Result is ConsulKvData and list of errors.
 *
 * @param {Array|undefined} data
 * @param {Boolean} json
 * @returns {{consulKvData: ConsulKvData, errors: Array}}
 */
function buildConsulKvData(data, json = false) {
    if (data === undefined) {
        return {consulKvData: new ConsulKvData([]), errors: []};
    }

    const {validRecords, errors} = ConsulResponseValidator.filterValidKvRecords(data);
    const records = [];

    validRecords.forEach(record => {
        const body = {
            metaData: record
        };

        if (json) {
            try {
                body.value = JSON.parse(record.Value);
            } catch (err) {
                const error = new InvalidDataError(
                    'Invalid JSON of Value field of KV is received from consul, record will be skipped',
                    {
                        key: record.Key,
                        value: record.Value
                    }
                );

                return errors.push(error);
            }
        } else {
            body.value = record.Value;
        }

        records.push([record.Key, body]);
    });

    const consulKvData = new ConsulKvData(records);
    return {consulKvData, errors};
}

module.exports = {
    buildConsulKvData
};
