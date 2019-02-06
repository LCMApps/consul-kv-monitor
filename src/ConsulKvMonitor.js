'use strict';

const EventEmitter = require('events');
const _ = require('lodash');

const AlreadyInitializedError = require('./Error').AlreadyInitializedError;
const WatchError = require('./Error').WatchError;
const WatchTimeoutError = require('./Error').WatchTimeoutError;
const kvFactory = require('./Factory');
const ConsulKvData = require('./ConsulKvData');

const DEFAULT_TIMEOUT_MSEC = 5000;
const HEALTH_FALLBACK_INTERVAL_MSEC = 1000;
const DEFAULT_RETRY_START_SERVICE_TIMEOUT_MSEC = 1000;
const X_CONSUL_HEADERS = ['x-consul-index', 'x-consul-knownleader', 'x-consul-lastcontact'];

/**
 * @emits ConsulKvMonitor#changed
 * @emits ConsulKvMonitor#error
 * @emits ConsulKvMonitor#healthy
 * @emits ConsulKvMonitor#unhealthy
 */
class ConsulKvMonitor extends EventEmitter {
    /**
     * @param {Object} options
     * @param {String} options.keysPrefix - namespace in consul to monitor
     * @param {Boolean} options.json - namespace in consul to monitor
     * @param {Number} [options.timeoutMsec=5000] - connection timeout to consul
     * @param {Consul} consul
     * @throws {TypeError} On invalid options format
     * @public
     */
    constructor(options, consul) {
        super();

        if (!_.isPlainObject(options)) {
            throw new TypeError('options must be an object');
        }

        if (!_.has(options, 'keysPrefix') || !_.isString(options.keysPrefix) || _.isEmpty(options.keysPrefix)) {
            throw new TypeError('options.keysPrefix must be set and be a non-empty string');
        }

        if (!_.has(options, 'timeoutMsec')) {
            this._timeoutMsec = DEFAULT_TIMEOUT_MSEC;
        } else {
            if (!_.isSafeInteger(options.timeoutMsec) || options.timeoutMsec <= 0) {
                throw new TypeError('options.timeoutMsec must be a positive integer if set');
            }

            this._timeoutMsec = options.timeoutMsec;
        }

        // duck typing check
        if (!_.isObject(consul) || !_.isFunction(consul.watch) ||
            !_.isObject(consul.kv) || !_.isFunction(consul.kv.get)
        ) {
            throw new TypeError('consul argument does not look like Consul object');
        }

        this._keysPrefix = options.keysPrefix;
        this._json = options.json;
        this._initialized = false;

        this._consul = consul;

        this._consulKvData = new ConsulKvData();
        this._consulHeaders = {};

        this._onWatcherChange = this._onWatcherChange.bind(this);
        this._onWatcherError = this._onWatcherError.bind(this);
        this._onWatcherEnd = this._onWatcherEnd.bind(this);
        this._retryStartService = this._retryStartService.bind(this);

        this._watchKvChange = null;
        this._setWatchUnhealthy();
        this._setUninitialized();

        this._fallbackToWatchHealthyInterval = null;
        this._retryTimer = null;
    }

    isWatchHealthy() {
        return this._isWatchHealthy;
    }

    _setWatchHealthy() {
        this._isWatchHealthy = true;
    }

    _setWatchUnhealthy() {
        this._isWatchHealthy = false;
    }

    isInitialized() {
        return this._initialized;
    }

    _setInitialized() {
        this._initialized = true;
    }

    _setUninitialized() {
        this._initialized = false;
    }

    _isWatcherRegistered() {
        return this._watchKvChange !== null;
    }

    /**
     * @returns {ConsulKvData}
     */
    getData() {
        return this._consulKvData;
    }

    /**
     * @returns {Object}
     */
    getConsulHeaders() {
        return this._consulHeaders;
    }

    /**
     * Starts service and resolves promise with initial list of KV data.
     *
     * Listens for changes after successful resolve.
     *
     * Promise will be rejected with:
     *   `AlreadyInitializedError` if service is already started.
     *   `WatchTimeoutError` if either initial data nor error received for 5000 msec
     *   `WatchError` on error from `consul` underlying method
     *
     * Rejection of promise means that watcher was stopped and no retries will be done.
     *
     * @returns {Promise.<Array>|Promise.<AlreadyInitializedError>|Promise.<WatchError>|Promise.<WatchTimeoutError>}
     * @public
     */
    start() {
        if (this._isWatcherRegistered()) {
            return Promise.reject(new AlreadyInitializedError('Service is already started'));
        }

        return this._registerWatcherAndWaitForInitialKvData()
            .then(kvData => {
                this._watchKvChange.on('change', this._onWatcherChange);
                this._watchKvChange.on('error', this._onWatcherError);
                this._watchKvChange.on('end', this._onWatcherEnd);

                this._setInitialized();
                this._setWatchHealthy();

                this._consulKvData = kvData;
                return kvData;
            });
    }

    /**
     * Stops service even if it is not started yet. Monitor becomes `uninitialized` and `unhealthy`.
     *
     * Does not listened for changes after execution.
     *
     * @returns {ConsulKvMonitor}
     * @public
     */
    stop() {
        if (this._retryTimer !== null) {
            clearTimeout(this._retryTimer);
            this._retryTimer = null;
        }

        if (!this._isWatcherRegistered()) {
            return this;
        }

        // we need to remove listener to prevent emitting of `end` event after stop of watcher
        this._watchKvChange.removeListener('end', this._onWatcherEnd);
        this._watchKvChange.end();
        this._watchKvChange = null;
        this._unsetFallbackToWatchHealthy();
        this._setUninitialized();
        this._setWatchUnhealthy();
        return this;
    }

    /**
     * Registers `consul.watch` and assigns watcher to `this._watchKvChange` and waits for the
     * first successful response from consul with list of KV data.
     * On successful response resolves promise with array of kv records (it may be empty). Method doesn't
     * add listener for `change` event.
     *
     * Promise will be rejected with:
     *   `AlreadyInitializedError` if another `consul.watch` execution is found.
     *   `WatchTimeoutError` if either initial data nor error received for 5000 msec
     *   `WatchError` on error from `consul` underlying method
     *
     * Rejection of promise means that watch was stopped and `this._watchKvChange` was cleared.
     *
     * @returns {Promise.<Array>|Promise.<AlreadyInitializedError>|Promise.<WatchError>|Promise.<WatchTimeoutError>}
     * @private
     */
    _registerWatcherAndWaitForInitialKvData() {
        return new Promise((resolve, reject) => {
            this._watchKvChange = this._consul.watch({
                method: this._consul.kv.get,
                options: {
                    key: this._keysPrefix,
                    recurse: true,
                    wait: '60s',
                },
            });

            const firstChange = (data, response) => {
                this._watchKvChange.removeListener('error', firstError);
                clearTimeout(timerId);

                const {consulKvData, errors} = kvFactory.buildConsulKvData(data, this._json);

                for (const headerName of X_CONSUL_HEADERS) {
                    this._consulHeaders[headerName] = response.headers[headerName];
                }

                if (!_.isEmpty(errors)) {
                    this._emitFactoryErrors(errors);
                }

                resolve(consulKvData);
            };

            const firstError = (err) => {
                this._watchKvChange.removeListener('change', firstChange);
                this._watchKvChange.end();
                this._watchKvChange = null;
                clearTimeout(timerId);
                reject(new WatchError(err.message, {err}));
            };

            const timerId = setTimeout(() => {
                this._watchKvChange.removeListener('error', firstError);
                this._watchKvChange.removeListener('change', firstChange);
                this._watchKvChange.end();
                this._watchKvChange = null;
                reject(new WatchTimeoutError('Initial consul watch request was timed out'));
            }, this._timeoutMsec);

            this._watchKvChange.once('change', firstChange);
            this._watchKvChange.once('error', firstError);
        });
    }

    /**
     * This method receives list of key-value records sent by `consul.watch` in `consul` format. Performs
     * parsing of response.
     *
     * If service was unhealthy, it becomes healthy.
     *
     * @param {Array} data - list of key-value records after some changes
     * @param {IncomingMessage} response - response from Consul
     * @emits ConsulKvMonitor#changed actual array of key-value records
     * @private
     */
    _onWatcherChange(data, response) {
        let isHealthyStateChanged = false;
        if (!this.isWatchHealthy()) {
            this._setWatchHealthy();
            isHealthyStateChanged = true;
        }

        const {consulKvData, errors} = kvFactory.buildConsulKvData(data, this._json);

        this._consulKvData = consulKvData;
        for (const headerName of X_CONSUL_HEADERS) {
            this._consulHeaders[headerName] = response.headers[headerName];
        }
        if (isHealthyStateChanged) {
            this.emit('healthy');
        }
        this.emit('changed', consulKvData);

        if (!_.isEmpty(errors)) {
            this._emitFactoryErrors(errors);
        }
    }

    /**
     * This method receives an Error from Consul.
     *
     * If service was healthy, it becomes unhealthy.
     *
     * @param {Error} err
     * @emits ConsulKvMonitor#error `WatchError` error
     * @private
     */
    _onWatcherError(err) {
        this._unsetFallbackToWatchHealthy();

        if (this.isWatchHealthy()) {
            this._setWatchUnhealthy();
            this.emit('unhealthy');
        }

        this._setFallbackToWatchHealthy();

        this.emit('error', new WatchError(err.message, {err}));
    }

    /**
     * This method is called when connection with Consul agent was refused.
     *
     * Monitor becomes `uninitialized` and `unhealthy`.
     *
     * @emits ConsulKvMonitor#unhealthy
     * @private
     */
    async _onWatcherEnd() {
        this._unsetFallbackToWatchHealthy();
        this._setUninitialized();
        if (this.isWatchHealthy()) {
            this._setWatchUnhealthy();
            this.emit('unhealthy');
        }
        this._watchKvChange = null;
        await this._retryStartService();
    }

    /**
     * This method receives a list of errors and emits them.
     *
     * @param {Error[]} errors
     * @emits ConsulKvMonitor#error
     * @private
     */
    _emitFactoryErrors(errors) {
        setImmediate(() => {
            errors.forEach(error => this.emit('error', error));
        });
    }

    /**
     * @private
     */
    _setFallbackToWatchHealthy() {
        if (this._fallbackToWatchHealthyInterval) {
            this._unsetFallbackToWatchHealthy();
        }

        const initialUpdateTime = this._watchKvChange.updateTime();

        this._fallbackToWatchHealthyInterval = setInterval(() => {
            if (this.isWatchHealthy()) {

                // watcher is currently ends or becomes `healthy`, unset fallback interval
                this._unsetFallbackToWatchHealthy();

                return;
            }

            const lastUpdateTime = this._watchKvChange.updateTime();

            if (initialUpdateTime !== lastUpdateTime) {
                this._unsetFallbackToWatchHealthy();

                this._setWatchHealthy();
                this.emit('healthy');
            }

        }, HEALTH_FALLBACK_INTERVAL_MSEC);
    }

    /**
     * @private
     */
    _unsetFallbackToWatchHealthy() {
        clearInterval(this._fallbackToWatchHealthyInterval);

        this._fallbackToWatchHealthyInterval = null;
    }

    async _retryStartService() {
        try {
            const consulKvData = await this.start();
            this._consulKvData = consulKvData;

            this.emit('healthy');
            this.emit('changed', consulKvData);
        } catch (err) {
            setImmediate(() => this.emit('error', err));

            this._retryTimer = setTimeout(this._retryStartService, DEFAULT_RETRY_START_SERVICE_TIMEOUT_MSEC);
        }
    }

}

module.exports = ConsulKvMonitor;
