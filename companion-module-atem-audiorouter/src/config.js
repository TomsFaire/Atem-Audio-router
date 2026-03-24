const { Regex } = require('@companion-module/base')

module.exports = {
	getConfigFields() {
		return [
			{
				type: 'static-text',
				id: 'info',
				label: 'Information',
				width: 12,
				value: `This module connects to the ATEM Audio Router server to control Fairlight audio routing on ATEM Constellation switchers.`,
			},
			{
				type: 'textinput',
				id: 'host',
				label: 'Server IP Address',
				width: 6,
				default: '127.0.0.1',
				regex: Regex.IP,
			},
			{
				type: 'textinput',
				id: 'port',
				label: 'Server Port',
				width: 3,
				default: 4000,
				regex: Regex.Port,
			},
			{
				type: 'static-text',
				id: 'dummy1',
				width: 12,
				label: ' ',
				value: ' ',
			},
			{
				type: 'checkbox',
				id: 'verbose',
				label: 'Enable Verbose Logging',
				default: false,
			},
		]
	},
}
