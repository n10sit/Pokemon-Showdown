'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');
const repl = require('repl');

/**
 * Contains the pathnames of all active REPL sockets.
 * @type {Set<string>}
 */
const socketPathnames = new Set();

process.once("exit", () => {
	socketPathnames.forEach(s => {
		try {
			fs.unlinkSync(s);
		} catch (e) {}
	});
});

// exit handlers aren't called by the default handler
if (process.listeners('SIGHUP').length === 0) {
	process.once('SIGHUP', () => process.exit(128 + 1));
}
if (process.listeners('SIGINT').length === 0) {
	process.once('SIGINT', () => process.exit(128 + 2));
}

/**
 * Starts a REPL server, using a UNIX socket for IPC. The eval function
 * parametre is passed in because there is no other way to access a file's
 * non-global context.
 *
 * @param {string} filename
 * @param {Function} evalFunction
 */
exports.start = function start(filename, evalFunction) {
	if ('repl' in Config && !Config.repl) return;

	// TODO: Windows does support the REPL when using named pipes. For now,
	// this only supports UNIX sockets.
	if (process.platform === 'win32') return;

	if (filename === 'app') {
		// Clean up old REPL sockets.
		let directory = path.dirname(path.resolve(__dirname, Config.replsocketprefix || 'logs/repl', 'app'));
		for (let file of fs.readdirSync(directory)) {
			let pathname = path.resolve(directory, file);
			let stat = fs.statSync(pathname);
			if (!stat.isSocket()) continue;

			let socket = net.connect(pathname, () => {
				socket.end();
				socket.destroy();
			}).on('error', () => {
				fs.unlink(pathname, () => {});
			});
		}
	}

	let server = net.createServer(socket => {
		// @ts-ignore
		repl.start({
			input: socket,
			output: socket,
			/**
			 * @param {string} cmd
			 * @param {any} context
			 * @param {string} filename
			 * @param {Function} callback
			 * @return {any}
			 */
			eval(cmd, context, filename, callback) {
				try {
					return callback(null, evalFunction(cmd));
				} catch (e) {
					return callback(e);
				}
			},
		}).on('exit', () => socket.end());
		socket.on('error', () => socket.destroy());
	});

	let pathname = path.resolve(__dirname, Config.replsocketprefix || 'logs/repl', filename);
	server.listen(pathname, () => {
		fs.chmodSync(pathname, Config.replsocketmode || 0o600);
		socketPathnames.add(pathname);
	});

	server.once('error', err => {
		// @ts-ignore
		if (err.code === "EADDRINUSE") {
			fs.unlink(pathname, _err => {
				// @ts-ignore
				if (_err && _err.code !== "ENOENT") {
					require('./crashlogger')(_err, `REPL: ${filename}`);
				}
				server.close();
			});
		} else {
			require('./crashlogger')(err, `REPL: ${filename}`);
			server.close();
		}
	});

	server.once('close', () => {
		socketPathnames.delete(pathname);
		start(filename, evalFunction);
	});
};
