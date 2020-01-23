# Changelog

### 2.0.3

- Dependencies was bumped

### 2.0.2

BUG FIXES:

- Potential bug with rejection of promise
[[GH-14](https://github.com/LCMApps/consul-kv-monitor/issues/14)]
- Does not emit "healthy" event in method
[[GH-15](https://github.com/LCMApps/consul-kv-monitor/issues/15)]
- JSDoc fixes

### 2.0.1

IMPROVEMENTS:

- Removing module "asyncawait" and support of Nodejs 6

### 2.0.0

IMPROVEMENTS:

- Add forwarding headers X-Consul-*
- Fix bug with default timeout for Consul Watch
- Add to consul-kv-monitor module functionality of an auto-reconnect to Сonsul
- Support auto-reconnect to Consul 
- Removed `emergencyStop` event from `ServiceInstancesMonitor`
- Added `healthy` and `unhealthy` events to `ServiceInstancesMonitor`
