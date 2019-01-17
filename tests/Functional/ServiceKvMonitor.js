'use strict';

const _ = require('lodash');
const consul = require('consul');
const nock = require('nock');
const assert = require('chai').assert;
const sinon = require('sinon');
const deepFreeze = require('deep-freeze');
const getPort = require('get-port');
const {assertThrowsAsync} = require('../support/helpers');
const ConsulKvData = require('src/ConsulKvData');
const ServiceKvMonitor = require('src/ConsulKvMonitor');
const {WatchError, WatchTimeoutError, InvalidDataError} = require('src/Error');

const nockTestParams = require('./nock.data');

describe('ConsulKvMonitor', function () {

    const consulHost = '127.0.0.1';
    let consulPort;
    let consulHostAndPort;
    let consulClient;
    const keysPrefix = 'mediaservermetrics/';

    const options = deepFreeze({
        keysPrefix,
        json: false,
        timeoutMsec: 500
    });

    before(async () => {
        consulPort = await getPort();
        consulHostAndPort = `http://${consulHost}:${consulPort}`;
    });

    beforeEach(function () {
        consulClient = consul({
            host: consulHost,
            port: consulPort,
            promisify: true
        });

        nock.cleanAll();
    });

    after(function () {
        nock.cleanAll();
    });

    it('not started monitor', function () {
        const monitor = new ServiceKvMonitor(options, consulClient);

        assert.isFalse(monitor.isInitialized());
        assert.isFalse(monitor.isWatchHealthy());
        assert.instanceOf(monitor.getData(), ConsulKvData);
        assert.equal(monitor.getData().getKeys().length, 0);
    });

    it('stop on not started monitor', function () {
        const monitor = new ServiceKvMonitor(options, consulClient);
        let returnedValue;
        assert.doesNotThrow(() => {
            returnedValue = monitor.stop();
        });

        assert.isFalse(monitor.isInitialized());
        assert.isFalse(monitor.isWatchHealthy());
        assert.instanceOf(monitor.getData(), ConsulKvData);
        assert.lengthOf(monitor.getData().getKeys(), 0);
        assert.strictEqual(returnedValue, monitor);
    });

    it('start monitor fails if port is closed', async () => {
        const monitor = new ServiceKvMonitor(options, consulClient);

        await assertThrowsAsync(
            () => monitor.start(),
            WatchError,
            /connect ECONNREFUSED/
        );
    });

    it('start monitor fails due to consul response timeout - no requests after timeout', async function () {
        // in this test monitor must response with WatchError after options.timeoutMsec
        // then after extra options.timeoutMsec time response from nock must be returned
        // and monitor must ignore that update

        this.timeout(options.timeoutMsec * 4);

        const nockInstance = nock(consulHostAndPort)
            .get(`/v1/kv/${encodeURIComponent(keysPrefix)}`).query({recurse: true, index: 0, wait: '60s'})
            .delay(options.timeoutMsec * 2)
            .reply(200, 'not a json')
            .get(`/v1/kv/${encodeURIComponent(keysPrefix)}`).query({recurse: true, index: 0, wait: '60s'})
            .reply(200, 'not a json');

        let changeFired = false;
        const monitor = new ServiceKvMonitor(options, consulClient);
        monitor.on('changed', () => {
            changeFired = true;
        });

        await assertThrowsAsync(
            () => monitor.start(),
            WatchTimeoutError,
            'Initial consul watch request was timed out'
        );

        const waitFn = () => {
            return new Promise(resolve => {
                setTimeout(resolve, options.timeoutMsec * 2);
            });
        };

        await waitFn();

        assert.isFalse(nockInstance.isDone());
        assert.isFalse(changeFired);
        assert.isFalse(monitor.isInitialized());
        assert.isFalse(monitor.isWatchHealthy());
        assert.instanceOf(monitor.getData(), ConsulKvData);
        assert.lengthOf(monitor.getData().getKeys(), 0);
        assert.deepEqual(monitor.getConsulHeaders(), {});
        monitor.stop();
    });

    it('monitor becomes initialized and watch becomes healthy after start of monitor', async function () {
        const expectedConsulHeaders = {
            'x-consul-index': nockTestParams.firstResponseHeaders['X-Consul-Index'],
            'x-consul-knownleader': nockTestParams.firstResponseHeaders['X-Consul-Knownleader'],
            'x-consul-lastcontact': nockTestParams.firstResponseHeaders['X-Consul-Lastcontact']
        };

        const firstRequestIndex = 0;
        // blocking queries read X-Consul-Index header and make next request using that value as index
        const secondRequestIndex = nockTestParams.firstResponseHeaders['X-Consul-Index'];

        const nockInstance = nock(consulHostAndPort)
            .get(`/v1/kv/${encodeURIComponent(keysPrefix)}`)
            .query({recurse: true, index: firstRequestIndex, wait: '60s'})
            .reply(200, nockTestParams.firstResponseBody, nockTestParams.firstResponseHeaders)
            .get(`/v1/kv/${encodeURIComponent(keysPrefix)}`)
            .query({recurse: true, index: secondRequestIndex, wait: '60s'})
            .delayBody(60000)
            .reply(200, nockTestParams.firstResponseBody, nockTestParams.firstResponseHeaders);

        const monitor = new ServiceKvMonitor(options, consulClient);
        await monitor.start();

        assert.isTrue(nockInstance.isDone());
        assert.isTrue(monitor.isInitialized());
        assert.isTrue(monitor.isWatchHealthy());
        assert.deepEqual(monitor.getConsulHeaders(), expectedConsulHeaders);
        monitor.stop();
    });

    it('check of initial data received from start', async function () {
        const expectedConsulHeaders = {
            'x-consul-index': nockTestParams.firstResponseHeaders['X-Consul-Index'],
            'x-consul-knownleader': nockTestParams.firstResponseHeaders['X-Consul-Knownleader'],
            'x-consul-lastcontact': nockTestParams.firstResponseHeaders['X-Consul-Lastcontact']
        };

        const expectedRecord1 = {
            key: keysPrefix + '192.168.101.5',
            value: 'test',
            metaData: {
                'Key': keysPrefix + '192.168.101.5',
                'Value': 'test',
                'CreateIndex': 351643,
                'Flags': 0,
                'LockIndex': 0,
                'ModifyIndex': 906432
            }
        };

        const expectedRecord2 = {
            key: keysPrefix + '192.168.101.6',
            value: 'test',
            metaData: {
                'Key': keysPrefix + '192.168.101.6',
                'Value': 'test',
                'CreateIndex': 350295,
                'Flags': 0,
                'LockIndex': 0,
                'ModifyIndex': 906434
            }
        };

        const firstRequestIndex = 0;
        // blocking queries read X-Consul-Index header and make next request using that value as index
        const secondRequestIndex = nockTestParams.firstResponseHeaders['X-Consul-Index'];

        nock(consulHostAndPort)
            .get(`/v1/kv/${encodeURIComponent(keysPrefix)}`)
            .query({recurse: true, index: firstRequestIndex, wait: '60s'})
            .reply(200, nockTestParams.firstResponseBody, nockTestParams.firstResponseHeaders)
            .get(`/v1/kv/${encodeURIComponent(keysPrefix)}`)
            .query({recurse: true, index: secondRequestIndex, wait: '60s'})
            .delayBody(60000)
            .reply(200, nockTestParams.firstResponseBody, nockTestParams.firstResponseHeaders);

        const monitor = new ServiceKvMonitor(options, consulClient);
        const initialData = await monitor.start();

        assert.instanceOf(initialData, ConsulKvData);
        assert.lengthOf(initialData.getKeys(), 2);
        assert.deepEqual(initialData.getKeys(), [expectedRecord1.key, expectedRecord2.key]);
        assert.isTrue(initialData.hasKey(expectedRecord1.key));
        assert.deepEqual(initialData.getValue(expectedRecord1.key), expectedRecord1.value);
        assert.deepEqual(initialData.getMetadata(expectedRecord1.key), expectedRecord1.metaData);
        assert.isTrue(initialData.hasKey(expectedRecord2.key));
        assert.deepEqual(initialData.getValue(expectedRecord2.key), expectedRecord2.value);
        assert.deepEqual(monitor.getConsulHeaders(), expectedConsulHeaders);
        assert.deepEqual(initialData.getMetadata(expectedRecord2.key), expectedRecord2.metaData);
        monitor.stop();
    });

    it('initial list of nodes is the same as received from getter', async function () {
        const firstRequestIndex = 0;
        // blocking queries read X-Consul-Index header and make next request using that value as index
        const secondRequestIndex = nockTestParams.firstResponseHeaders['X-Consul-Index'];

        nock(consulHostAndPort)
            .get(`/v1/kv/${encodeURIComponent(keysPrefix)}`)
            .query({recurse: true, index: firstRequestIndex, wait: '60s'})
            .reply(200, nockTestParams.firstResponseBody, nockTestParams.firstResponseHeaders)
            .get(`/v1/kv/${encodeURIComponent(keysPrefix)}`)
            .query({recurse: true, index: secondRequestIndex, wait: '60s'})
            .delayBody(60000)
            .reply(200, nockTestParams.firstResponseBody, nockTestParams.firstResponseHeaders);

        const monitor = new ServiceKvMonitor(options, consulClient);
        const initialData = await monitor.start();
        const dataFromGetter = monitor.getData();

        assert.strictEqual(initialData, dataFromGetter);
        monitor.stop();
    });

    it('reaction on 500 error from consul during start', async function () {
        this.timeout(options.timeoutMsec * 5);

        const firstRequestIndex = 0;

        const nockInstance = nock(consulHostAndPort)
            .get(`/v1/kv/${encodeURIComponent(keysPrefix)}`)
            .query({recurse: true, index: firstRequestIndex, wait: '60s'})
            .reply(500, 'Internal error')
            .get(`/v1/kv/${encodeURIComponent(keysPrefix)}`)
            .query({recurse: true, index: firstRequestIndex, wait: '60s'})
            .reply(200, nockTestParams.firstResponseBody, nockTestParams.firstResponseHeaders);

        let changeFired = false;
        const monitor = new ServiceKvMonitor(options, consulClient);

        monitor.on('changed', () => {
            changeFired = true;
        });

        await assertThrowsAsync(
            () => monitor.start(),
            WatchError,
            'internal server error'
        );


        const waitFn = () => {
            return new Promise(resolve => {
                setTimeout(resolve, options.timeoutMsec * 2);
            });
        };

        await waitFn();

        assert.isFalse(nockInstance.isDone());
        assert.isFalse(changeFired);
        assert.isFalse(monitor.isInitialized());
        assert.isFalse(monitor.isWatchHealthy());
        assert.lengthOf(monitor.getData().getKeys(), 0);
        assert.deepEqual(monitor.getConsulHeaders(), {});
    });

    it('reaction on 400 error from consul during start', async function () {
        this.timeout(options.timeoutMsec * 5);

        const firstRequestIndex = 0;

        const nockInstance = nock(consulHostAndPort)
            .get(`/v1/kv/${encodeURIComponent(keysPrefix)}`)
            .query({recurse: true, index: firstRequestIndex, wait: '60s'})
            .reply(400, 'Internal error')
            .get(`/v1/kv/${encodeURIComponent(keysPrefix)}`)
            .query({recurse: true, index: firstRequestIndex, wait: '60s'})
            .reply(200, nockTestParams.firstResponseBody, nockTestParams.firstResponseHeaders);

        let changeFired = false;
        const monitor = new ServiceKvMonitor(options, consulClient);

        monitor.on('changed', () => {
            changeFired = true;
        });

        await assertThrowsAsync(
            () => monitor.start(),
            WatchError,
            'bad request'
        );


        const waitFn = () => {
            return new Promise(resolve => {
                setTimeout(resolve, options.timeoutMsec * 2);
            });
        };

        await waitFn();

        assert.isFalse(nockInstance.isDone());
        assert.isFalse(changeFired);
        assert.isFalse(monitor.isInitialized());
        assert.isFalse(monitor.isWatchHealthy());
        assert.lengthOf(monitor.getData().getKeys(), 0);
        assert.deepEqual(monitor.getConsulHeaders(), {});
    });

    it('emission of error on initial data', async function () {
        const expectedConsulHeaders = {
            'x-consul-index': nockTestParams.firstResponseHeaders['X-Consul-Index'],
            'x-consul-knownleader': nockTestParams.firstResponseHeaders['X-Consul-Knownleader'],
            'x-consul-lastcontact': nockTestParams.firstResponseHeaders['X-Consul-Lastcontact']
        };
        const expectedErrorType = InvalidDataError;
        const expectedErrorMessage = 'Invalid format of record data received from consul KV';
        const expectedErrorExtra = {
            record: {
                'Key': 'mediaservermetrics/192.168.101.5',
                'Value': 'test'
            }
        };

        const responseBody = [
            {
                'Key': 'mediaservermetrics/192.168.101.5',
                'Value': '"dGVzdA=="'
            }
        ];

        const firstRequestIndex = 0;
        // blocking queries read X-Consul-Index header and make next request using that value as index
        const secondRequestIndex = nockTestParams.firstResponseHeaders['X-Consul-Index'];

        nock(consulHostAndPort)
            .get(`/v1/kv/${encodeURIComponent(keysPrefix)}`)
            .query({recurse: true, index: firstRequestIndex, wait: '60s'})
            .reply(200, responseBody, nockTestParams.firstResponseHeaders)
            .get(`/v1/kv/${encodeURIComponent(keysPrefix)}`)
            .query({recurse: true, index: secondRequestIndex, wait: '60s'})
            .delayBody(60000)
            .reply(200, responseBody, nockTestParams.firstResponseHeaders);

        const waitFn = () => {
            return new Promise(resolve => {
                setTimeout(resolve, 10);
            });
        };

        const errors = [];
        const monitor = new ServiceKvMonitor(options, consulClient);
        monitor.on('error', (error) => {
            errors.push(error);
        });

        const initialData = await monitor.start();

        assert.lengthOf(errors, 0);

        assert.instanceOf(initialData, ConsulKvData);
        assert.lengthOf(initialData.getKeys(), 0);

        await waitFn();

        assert.lengthOf(errors, 1);
        assert.instanceOf(errors[0], expectedErrorType);
        assert.strictEqual(errors[0].message, expectedErrorMessage);
        assert.deepEqual(errors[0].extra, expectedErrorExtra);
        assert.deepEqual(monitor.getConsulHeaders(), expectedConsulHeaders);
        monitor.stop();
    });

    it('auto restart service on watcher "end" (response with status 400)', async function () {
        const expectedConsulHeaders = {
            'x-consul-index': nockTestParams.firstResponseHeaders['X-Consul-Index'],
            'x-consul-knownleader': nockTestParams.firstResponseHeaders['X-Consul-Knownleader'],
            'x-consul-lastcontact': nockTestParams.firstResponseHeaders['X-Consul-Lastcontact']
        };
        const firstRequestIndex = 0;
        const secondRequestIndex = nockTestParams.firstResponseHeaders['X-Consul-Index'];
        const secondResponseBody = [nockTestParams.firstResponseBody[0]];

        const nockInstance = nock(consulHostAndPort)
            .get(`/v1/kv/${encodeURIComponent(keysPrefix)}`)
            .query({recurse: true, index: firstRequestIndex, wait: '60s'})
            .reply(200, nockTestParams.firstResponseBody, nockTestParams.firstResponseHeaders)
            .get(`/v1/kv/${encodeURIComponent(keysPrefix)}`)
            .query({recurse: true, index: secondRequestIndex, wait: '60s'})
            .reply(400, 'Not available')
            .get(`/v1/kv/${encodeURIComponent(keysPrefix)}`)
            .query({recurse: true, index: firstRequestIndex, wait: '60s'})
            .reply(200, secondResponseBody, nockTestParams.firstResponseHeaders)
            .get(`/v1/kv/${encodeURIComponent(keysPrefix)}`)
            .query({recurse: true, index: secondRequestIndex, wait: '60s'})
            .delayBody(60000)
            .reply(200, 'Not available');

        let changeFiredCount = 0;
        let healthyFiredCount = 0;
        let unhealthyFiredCount = 0;
        const errors = [];
        const monitor = new ServiceKvMonitor(options, consulClient);

        sinon.spy(monitor, '_retryStartService');

        monitor.on('changed', () => {
            changeFiredCount++;
        });

        monitor.on('error', err => {
            errors.push(err);
        });

        monitor.on('healthy', () => {
            healthyFiredCount++;
        });

        monitor.on('unhealthy', () => {
            unhealthyFiredCount++;
        });

        await monitor.start();

        const waitFn = () => {
            return new Promise(resolve => {
                setTimeout(resolve, options.timeoutMsec / 2);
            });
        };

        await waitFn();

        assert.isTrue(nockInstance.isDone());
        assert.equal(changeFiredCount, 1);
        assert.equal(healthyFiredCount, 1);
        assert.equal(unhealthyFiredCount, 1);
        assert.isTrue(monitor.isInitialized());
        assert.isTrue(monitor.isWatchHealthy());
        assert.lengthOf(errors, 1);
        assert.instanceOf(errors[0], WatchError);
        assert.isTrue(monitor._isWatcherRegistered());
        assert.isTrue(monitor._retryStartService.calledOnce);
        assert.isTrue(monitor._retryStartService.calledWithExactly());
        assert.deepEqual(monitor.getConsulHeaders(), expectedConsulHeaders);
        monitor.stop();
    });

    it('service goes to "unhealthy" state on response with status 500 and ' +
        'returns to "healthy" after success response', async function () {
        const firstRequestIndex = 0;
        const secondRequestIndex = nockTestParams.firstResponseHeaders['X-Consul-Index'];
        const secondResponseBody = [nockTestParams.firstResponseBody[0]];
        const secondResponseHeaders = _.cloneDeep(nockTestParams.firstResponseHeaders);
        secondResponseHeaders['X-Consul-Index'] += 1;
        const thirdRequestIndex = secondResponseHeaders['X-Consul-Index'];

        const expectedConsulHeaders = {
            'x-consul-index': secondResponseHeaders['X-Consul-Index'],
            'x-consul-knownleader': secondResponseHeaders['X-Consul-Knownleader'],
            'x-consul-lastcontact': secondResponseHeaders['X-Consul-Lastcontact']
        };

        const nockInstance = nock(consulHostAndPort)
            .get(`/v1/kv/${encodeURIComponent(keysPrefix)}`)
            .query({recurse: true, index: firstRequestIndex, wait: '60s'})
            .reply(200, nockTestParams.firstResponseBody, nockTestParams.firstResponseHeaders)
            .get(`/v1/kv/${encodeURIComponent(keysPrefix)}`)
            .query({recurse: true, index: secondRequestIndex, wait: '60s'})
            .reply(500, 'Not available')
            .get(`/v1/kv/${encodeURIComponent(keysPrefix)}`)
            .query({recurse: true, index: secondRequestIndex, wait: '60s'})
            .reply(200, secondResponseBody, secondResponseHeaders)
            .get(`/v1/kv/${encodeURIComponent(keysPrefix)}`)
            .query({recurse: true, index: thirdRequestIndex, wait: '60s'})
            .delayBody(60000)
            .reply(400, 'Not available');

        let changeFiredCount = 0;
        let firedData;
        let healthyFiredCount = 0;
        let unhealthyFiredCount = 0;
        const errors = [];
        const monitor = new ServiceKvMonitor(options, consulClient);

        sinon.spy(monitor, '_retryStartService');

        monitor.on('changed', data => {
            changeFiredCount++;
            firedData = data;
        });

        monitor.on('error', err => {
            errors.push(err);
        });

        monitor.on('unhealthy', () => {
            unhealthyFiredCount++;
        });

        monitor.on('healthy', () => {
            healthyFiredCount++;
        });

        await monitor.start();

        const waitFn = () => {
            return new Promise(resolve => {
                setTimeout(resolve, options.timeoutMsec / 2);
            });
        };

        await waitFn();

        assert.isTrue(nockInstance.isDone());
        assert.equal(changeFiredCount, 1);
        assert.equal(unhealthyFiredCount, 1);
        assert.equal(healthyFiredCount, 1);
        assert.isTrue(monitor.isInitialized());
        assert.isTrue(monitor.isWatchHealthy());
        assert.deepEqual(firedData, monitor.getData());
        assert.lengthOf(errors, 1);
        assert.instanceOf(errors[0], WatchError);
        assert.isTrue(monitor._isWatcherRegistered());
        assert.isTrue(monitor._retryStartService.notCalled);
        assert.deepEqual(monitor.getConsulHeaders(), expectedConsulHeaders);
        monitor.stop();
    });
});
