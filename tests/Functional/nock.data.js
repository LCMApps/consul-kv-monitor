const loadData1 = {
    status: 'OK',
    pid: 100,
    mem: {
        total: 12813,
        free: 11786
    },
    cpu: {
        usage: 0.72,
        count: 16
    }
};

module.exports = {
    loadData1: loadData1,
    firstResponseHeaders: {
        'X-Consul-Index': '313984',
        'X-Consul-Knownleader': 'true',
        'X-Consul-Lastcontact': '0'
    },
    firstResponseBody: [
        {
            'CreateIndex': 351643,
            'Flags': 0,
            'Key': 'mediaservermetrics/192.168.101.5',
            'LockIndex': 0,
            'ModifyIndex': 906432,
            'Value': '"dGVzdA=="'
        },
        {
            'CreateIndex': 350295,
            'Flags': 0,
            'Key': 'mediaservermetrics/192.168.101.6',
            'LockIndex': 0,
            'ModifyIndex': 906434,
            'Value': '"dGVzdA=="'
        }
    ]
};

