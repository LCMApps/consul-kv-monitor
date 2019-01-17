'use strict';

const _ = require('lodash');
const assert = require('chai').assert;
const dataDriven = require('data-driven');

const ConsulKvData = require('src/ConsulKvData');
const InvalidDataError = require('src/Error').InvalidDataError;
const buildConsulKvData = require('src/Factory').buildConsulKvData;

function vt(value) {
    return {value, type: (value === null ? 'null' : typeof value)};
}

const notAnArray = [
    vt('string'), vt(true), vt(123), vt(Symbol()), vt(setTimeout), vt(null)
];

describe('Factory::buildConsulKvData', function () {

    dataDriven(notAnArray, function () {
        it('tests wrong consul response type = {type}', function (arg) {
            const expErrorMsg = 'Invalid format of data received from consul KV';

            const {consulKvData, errors} = buildConsulKvData(arg.value);

            assert.instanceOf(consulKvData, ConsulKvData);
            assert.isArray(errors);
            assert.isEmpty(consulKvData.getKeys());
            assert.lengthOf(errors, 1);
            assert.instanceOf(errors[0], InvalidDataError);
            assert.strictEqual(errors[0].message, expErrorMsg);
        });
    });

    it('tests empty response fro consul = undefined', function () {
        const {consulKvData, errors} = buildConsulKvData(undefined);

        assert.instanceOf(consulKvData, ConsulKvData);
        assert.lengthOf(consulKvData.getKeys(), 0);
        assert.isArray(errors);
        assert.lengthOf(errors, 0);
    });

    it('tests mixed value format from consul response with "json" flag equal true', function () {
        const expectedValue = {key: 'value'};
        const data = [
            {
                Key: 'key1',
                Value: JSON.stringify(expectedValue),
                CreateIndex: 351643,
                Flags: 0,
                LockIndex: 0,
                ModifyIndex: 906432
            },
            {
                Key: 'key2',
                Value: 'someValue',
                CreateIndex: 351643,
                Flags: 0,
                LockIndex: 0,
                ModifyIndex: 906432
            },
        ];

        const {consulKvData, errors} = buildConsulKvData(_.cloneDeep(data), true);

        assert.instanceOf(consulKvData, ConsulKvData);
        assert.lengthOf(consulKvData.getKeys(), 1);
        assert.deepEqual(consulKvData.getValue(data[0].Key), expectedValue);
        assert.isArray(errors);
        assert.lengthOf(errors, 1);
        assert.instanceOf(errors[0], InvalidDataError);
    });

    it('tests mixed value format from consul response with "json" flag equal false', function () {
        const expectedValue1 = JSON.stringify({key: 'value'});
        const expectedValue2 = 'someValue';
        const data = [
            {
                Key: 'key1',
                Value: expectedValue1,
                CreateIndex: 351643,
                Flags: 0,
                LockIndex: 0,
                ModifyIndex: 906432
            },
            {
                Key: 'key2',
                Value: expectedValue2,
                CreateIndex: 351643,
                Flags: 0,
                LockIndex: 0,
                ModifyIndex: 906432
            }
        ];

        const {consulKvData, errors} = buildConsulKvData(_.cloneDeep(data), false);

        assert.instanceOf(consulKvData, ConsulKvData);
        assert.lengthOf(consulKvData.getKeys(), 2);
        assert.deepEqual(consulKvData.getValue(data[0].Key), expectedValue1);
        assert.deepEqual(consulKvData.getValue(data[1].Key), expectedValue2);
        assert.isArray(errors);
        assert.lengthOf(errors, 0);
    });
});
