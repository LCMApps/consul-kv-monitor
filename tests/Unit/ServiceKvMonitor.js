'use strict';

const _ = require('lodash');
const consul = require('consul');
const assert = require('chai').assert;
const dataDriven = require('data-driven');
const deepFreeze = require('deep-freeze');
const ServiceKvMonitor = require('src/ConsulKvMonitor');
const ConsulKvData = require('src/ConsulKvData');
const WatchError = require('src/Error/index').WatchError;
const sinon = require('sinon');

/**
 * Returns object with passed to function variable itself and its type.
 *
 * As of 'null' has type of 'object' in ECMAScript, function returns 'null' for it.
 *
 * @example
 *   `{value: 123, type: 'number'}`
 *   '{value: Symbol(), type: 'symbol'}`
 *   `{value: null, type: 'null'}`
 *
 * @param {*} value - value of any type
 * @returns {{value: *, type: string}}
 */
function vt(value) {
    return { value, type: (value === null ? 'null' : typeof value) };
}

const testParams = {
    // all type except number
    notANumber: [
        vt('string'), vt(true), vt(undefined), vt(Symbol()), vt({ }), vt(setTimeout), vt(null)
    ],
    // all types except string
    notAString: [
        vt(true), vt(123), vt(undefined), vt(Symbol()), vt({ }), vt(setTimeout), vt(null)
    ],
    // all types except object
    notAnObject: [
        vt('string'), vt(true), vt(123), vt(undefined), vt(Symbol()), vt(setTimeout), vt(null)
    ],
    notAFunction: [
        vt('string'), vt(true), vt(123), vt(undefined), vt(Symbol()), vt({ }), vt(null)
    ]
};

describe('ConsulKvMonitor::constructor', function () {

    const validOptions = deepFreeze({
        keysPrefix: 'crabscoder/',
        json: false,
        timeoutMsec: 1000
    });

    let validConsulClient;

    beforeEach(() => {
        validConsulClient = consul();
    });

    it('valid arguments', function () {
        (new ServiceKvMonitor(validOptions, validConsulClient));
    });

    dataDriven(testParams.notAnObject, function () {
        it('incorrect type of options argument, type = {type}', function (arg) {
            /** @var {{value: *, type: string}} arg */
            assert.throws(
                function () {
                    new ServiceKvMonitor(arg.value, validConsulClient);
                },
                TypeError,
                'options must be an object'
            );
        });
    });

    it('missed mandatory options.keysPrefix argument', function () {
        const options = {};

        assert.throws(
            function () {
                new ServiceKvMonitor(options, validConsulClient);
            },
            TypeError,
            'options.keysPrefix must be set and be a non-empty string'
        );
    });

    dataDriven(testParams.notAString, function () {
        it('incorrect type of options.keysPrefix argument, type = {type}', function (arg) {
            const options = _.set(_.cloneDeep(validOptions), 'keysPrefix', arg.value);

            /** @var {{value: *, type: string}} arg */
            assert.throws(
                function () {
                    new ServiceKvMonitor(options, validConsulClient);
                },
                TypeError,
                'options.keysPrefix must be set and be a non-empty string'
            );
        });
    });

    it('empty options.keysPrefix argument', function () {
        const options = _.set(_.cloneDeep(validOptions), 'keysPrefix', '');

        assert.throws(
            function () {
                new ServiceKvMonitor(options, validConsulClient);
            },
            TypeError,
            'options.keysPrefix must be set and be a non-empty string'
        );
    });

    it('absent options.timeoutMsec argument', function () {
        const options = deepFreeze(_.omit(_.cloneDeep(validOptions), 'timeoutMsec'));

        assert.notProperty(options, 'timeoutMsec');
        (new ServiceKvMonitor(options, validConsulClient));
    });

    dataDriven(testParams.notANumber, function () {
        it('incorrect type of options.timeoutMsec property, type = {type}', function (arg) {
            const options = _.set(_.cloneDeep(validOptions), 'timeoutMsec', arg.value);

            /** @var {{value: *, type: string}} arg */
            assert.throws(
                function () {
                    new ServiceKvMonitor(options, validConsulClient);
                },
                TypeError,
                'options.timeoutMsec must be a positive integer if set'
            );
        });
    });

    dataDriven(testParams.notAnObject, function () {
        it('incorrect type of consul argument, type = {type}', function (arg) {
            /** @var {{value: *, type: string}} arg */
            assert.throws(
                function () {
                    new ServiceKvMonitor(validOptions, arg.value);
                },
                TypeError,
                'consul argument does not look like Consul object'
            );
        });
    });

    dataDriven(testParams.notAFunction, function () {
        it('incorrect type of consul.watch method, type = {type}', function (arg) {
            const consulClient = _.set(_.cloneDeep(validConsulClient), 'watch', arg.value);

            /** @var {{value: *, type: string}} arg */
            assert.throws(
                function () {
                    new ServiceKvMonitor(validOptions, consulClient);
                },
                TypeError,
                'consul argument does not look like Consul object'
            );
        });
    });

    dataDriven(testParams.notAnObject, function () {
        it('incorrect type of consul.kv object, type = {type}', function (arg) {
            const consulClient = _.set(_.cloneDeep(validConsulClient), 'kv', arg.value);

            /** @var {{value: *, type: string}} arg */
            assert.throws(
                function () {
                    new ServiceKvMonitor(validOptions, consulClient);
                },
                TypeError,
                'consul argument does not look like Consul object'
            );
        });
    });

    dataDriven(testParams.notAFunction, function () {
        it('incorrect type of consul.kv.get method, type = {type}', function (arg) {
            const consulClient = _.set(_.cloneDeep(validConsulClient), 'kv.get', arg.value);

            /** @var {{value: *, type: string}} arg */
            assert.throws(
                function () {
                    new ServiceKvMonitor(validOptions, consulClient);
                },
                TypeError,
                'consul argument does not look like Consul object'
            );
        });
    });
});

describe('ConsulKvMonitor::_setFallbackToWatchHealthy', () => {
    let tg;
    let clock;

    beforeEach(() => {
        clock = sinon.useFakeTimers();

        tg = sinon.createStubInstance(ServiceKvMonitor);

        tg._watchKvChange = {
            updateTime: sinon.stub(),
            isRunning:  sinon.stub(),
        };
    });

    afterEach(() => clock.restore());

    it('should unset previous fallback interval if it exists', () => {
        tg._setFallbackToWatchHealthy.restore();

        tg._fallbackToWatchHealthyInterval = 123;

        tg._setFallbackToWatchHealthy();

        assert.isOk(tg._unsetFallbackToWatchHealthy.calledOnce);

        sinon.assert.callOrder(
            tg._unsetFallbackToWatchHealthy, tg._watchKvChange.updateTime
        );

        clearInterval(tg._fallbackToWatchHealthyInterval);
    });

    it('should correctly stops working when watch becomes healthy', () => {
        tg._setFallbackToWatchHealthy.restore();

        tg._unsetFallbackToWatchHealthy.callThrough();

        tg._fallbackToWatchHealthyInterval = null;

        tg._watchKvChange.updateTime.returns(123);
        tg.isWatchHealthy.returns(false);

        tg._setFallbackToWatchHealthy();

        assert.isOk(tg._watchKvChange.updateTime.calledOnce);
        assert.isNotNull(tg._fallbackToWatchHealthyInterval);
        assert.isOk(tg._unsetFallbackToWatchHealthy.notCalled);

        clock.tick(5000);

        tg.isWatchHealthy.returns(true);

        clock.tick(1000);

        assert.isOk(tg._unsetFallbackToWatchHealthy.calledOnce);
        assert.isOk(tg._setWatchHealthy.notCalled);

        sinon.assert.callOrder(
            tg._watchKvChange.updateTime, tg.isWatchHealthy, tg._unsetFallbackToWatchHealthy
        );

        assert.isNull(tg._fallbackToWatchHealthyInterval);
    });

    it('should correctly fallbacks to healthy state', () => {
        tg._setFallbackToWatchHealthy.restore();

        tg._unsetFallbackToWatchHealthy.callThrough();

        tg._fallbackToWatchHealthyInterval = null;

        tg._watchKvChange.updateTime.returns(123);
        tg.isWatchHealthy.returns(false);

        tg._setFallbackToWatchHealthy();

        assert.isOk(tg._watchKvChange.updateTime.calledOnce);
        assert.isNotNull(tg._fallbackToWatchHealthyInterval);
        assert.isOk(tg._unsetFallbackToWatchHealthy.notCalled);

        clock.tick(5000);

        tg._watchKvChange.updateTime.returns(1234);

        clock.tick(1000);

        assert.isOk(tg._unsetFallbackToWatchHealthy.calledOnce);
        assert.isOk(tg._setWatchHealthy.calledOnce);

        sinon.assert.callOrder(
            tg._watchKvChange.updateTime,
            tg.isWatchHealthy,
            tg._watchKvChange.updateTime,
            tg._unsetFallbackToWatchHealthy,
            tg._setWatchHealthy
        );

        assert.isNull(tg._fallbackToWatchHealthyInterval);
    });
});

describe('ServiceInstancesMonitor::_retryStartService', function () {
    const options = deepFreeze({
        keysPrefix: '/someKey',
        json: false,
        timeoutMsec: 500
    });
    const consulClient = consul();

    it('successfully restart watcher', async function () {
        const kvData = new ConsulKvData();
        const monitor = new ServiceKvMonitor(options, consulClient, undefined);

        const serviceStartStub = sinon.stub(monitor, 'start');
        serviceStartStub.returns(kvData);

        let changeFired = false;
        let healthyFired = false;
        let firedData = undefined;

        monitor.on('changed', kvData => {
            changeFired = true;
            firedData = kvData;
        });

        monitor.on('healthy', () => {
            healthyFired = true;
        });

        await monitor._retryStartService();

        assert.isTrue(changeFired);
        assert.isTrue(healthyFired);
        assert.isTrue(serviceStartStub.calledOnce);
        assert.isTrue(serviceStartStub.calledWithExactly());
        assert.deepEqual(monitor._consulKvData, kvData);
        assert.deepEqual(firedData, kvData);
    });

    it('on error from "start()" retry run "_retryStartService" after timeout', async function () {
        const DEFAULT_RETRY_START_SERVICE_TIMEOUT_MSEC = 1000;

        this.timeout(DEFAULT_RETRY_START_SERVICE_TIMEOUT_MSEC * 3);

        const kvData = new ConsulKvData();
        const monitor = new ServiceKvMonitor(options, consulClient, undefined);

        const serviceStartStub = sinon.stub(monitor, 'start');
        serviceStartStub.onFirstCall().rejects(new WatchError('Some error'));
        serviceStartStub.onSecondCall().returns(kvData);

        const retryStartServiceSpy = sinon.spy(monitor, '_retryStartService');

        let changedFiredCount = 0;
        let healthyFiredCount = 0;
        let firedData = undefined;
        const errors = [];

        monitor.on('changed', kvData => {
            changedFiredCount++;
            firedData = kvData;
        });

        monitor.on('error', error => {
            errors.push(error);
        });

        monitor.on('healthy', () => {
            healthyFiredCount++;
        });

        function waitFn() {
            return new Promise(resolve => {
                setTimeout(resolve, DEFAULT_RETRY_START_SERVICE_TIMEOUT_MSEC * 2);
            });
        }

        await monitor._retryStartService();

        await waitFn();

        assert.equal(changedFiredCount, 1);
        assert.equal(healthyFiredCount, 1);
        assert.isTrue(retryStartServiceSpy.calledTwice);
        assert.isTrue(serviceStartStub.calledTwice);
        assert.isTrue(serviceStartStub.calledWithExactly());
        assert.deepEqual(monitor._consulKvData, kvData);
        assert.deepEqual(firedData, kvData);
        assert.lengthOf(errors, 1);
        assert.instanceOf(errors[0], WatchError);
        assert.match(errors[0], /Some error/);
    });

    it('not retry run "_retryStartService" after "stop()" calling', async function () {
        const DEFAULT_RETRY_START_SERVICE_TIMEOUT_MSEC = 1000;

        this.timeout(DEFAULT_RETRY_START_SERVICE_TIMEOUT_MSEC * 3);

        const kvData = new ConsulKvData();
        const monitor = new ServiceKvMonitor(options, consulClient, undefined);

        const serviceStartStub = sinon.stub(monitor, 'start');
        serviceStartStub.onFirstCall().rejects(new WatchError('Some error'));
        serviceStartStub.onSecondCall().returns(kvData);

        const retryStartServiceSpy = sinon.spy(monitor, '_retryStartService');

        let isChangeFired = false;
        const errors = [];

        monitor.on('changed', kvData => {
            isChangeFired = true;
        });

        monitor.on('error', error => {
            errors.push(error);
        });

        function waitFn() {
            return new Promise(resolve => {
                setTimeout(resolve, DEFAULT_RETRY_START_SERVICE_TIMEOUT_MSEC * 2);
            });
        }

        await monitor._retryStartService();

        monitor.stop();

        await waitFn();

        assert.isFalse(isChangeFired);
        assert.isTrue(retryStartServiceSpy.calledOnce);
        assert.isTrue(serviceStartStub.calledOnce);
        assert.isTrue(serviceStartStub.calledWithExactly());
        assert.lengthOf(errors, 1);
        assert.instanceOf(errors[0], WatchError);
        assert.match(errors[0], /Some error/);
    });
});
