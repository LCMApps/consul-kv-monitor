# Changelog

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
