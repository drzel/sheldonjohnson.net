// Foundation Footy 2-player networking.
// A single WebRTC data channel between host and guest; PeerJS's free public
// broker handles the handshake, then all traffic is peer-to-peer. The game
// (GDScript) talks to this through window.ffnet via JavaScriptBridge.
(function () {
	'use strict';
	// no 0/O/1/I/L — codes get read out loud over the phone
	var ALPHA = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
	var PREFIX = 'ffooty-v1-';
	var QUEUE_MAX = 256; // backgrounded tabs stop draining; don't hoard forever
	var ICE = {
		iceServers: [
			{ urls: 'stun:stun.l.google.com:19302' },
			{ urls: 'stun:stun1.l.google.com:19302' },
			// free TURN relay so CGNAT/mobile testers can still connect
			{ urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
			{ urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
		],
	};

	var net = {
		status: 'idle', // idle | starting | hosting | connecting | connected | closed | error:<detail>
		code: '',
		_peer: null,
		_conn: null,
		_queue: [],

		_newCode: function () {
			var s = '';
			for (var i = 0; i < 4; i++) s += ALPHA[Math.floor(Math.random() * ALPHA.length)];
			return s;
		},

		_adopt: function (conn) {
			if (net._conn) {
				// lobby already has an opponent: let the extra joiner's channel
				// open, tell them the game is full, then hang up — a silent close
				// would leave them guessing until their timeout
				conn.on('open', function () {
					try { conn.send('{"t":"full"}'); } catch (e) {}
					setTimeout(function () { try { conn.close(); } catch (e) {} }, 200);
				});
				return;
			}
			net._conn = conn;
			conn.on('data', function (d) {
				if (net._queue.length >= QUEUE_MAX) net._queue.shift();
				net._queue.push(String(d));
			});
			conn.on('open', function () { net.status = 'connected'; });
			conn.on('close', function () {
				if (net._conn === conn) net._conn = null; // free the slot for a rejoin
				if (net.status === 'connected') net.status = 'closed';
			});
			conn.on('error', function () {
				if (net._conn === conn) net._conn = null;
				if (net.status === 'connected') net.status = 'closed';
			});
		},

		_mkpeer: function (id, hostTries) {
			var peer = new Peer(id, { config: ICE, debug: 1 });
			net._peer = peer;
			peer.on('error', function (e) {
				var t = (e && e.type) || 'network';
				if (t === 'unavailable-id' && hostTries > 0) {
					try { peer.destroy(); } catch (err) {}
					net._host(hostTries - 1);
					return;
				}
				if (net.status === 'connected') {
					// a broker (signaling) hiccup doesn't touch the live P2P
					// channel — the DataConnection handlers catch real link loss
					if (t === 'network' || t === 'disconnected') {
						try { peer.reconnect(); } catch (err) {}
						return;
					}
					if (t !== 'peer-unavailable') net.status = 'closed';
					return;
				}
				if (t === 'peer-unavailable') net.status = 'error:no game found for that code';
				else net.status = 'error:' + t;
			});
			peer.on('disconnected', function () {
				// broker socket dropped: if we're hosting and still waiting, the
				// code can no longer be reached — try to get it back
				if (net.status === 'hosting' || net.status === 'connected') {
					try { peer.reconnect(); } catch (err) {}
				}
			});
			return peer;
		},

		host: function () {
			net.close();
			net.status = 'starting';
			try {
				net._host(5);
			} catch (e) {
				net.status = 'error:networking unavailable';
			}
		},
		_host: function (tries) {
			var code = net._newCode();
			var peer = net._mkpeer(PREFIX + code, tries);
			peer.on('open', function () { net.code = code; net.status = 'hosting'; });
			peer.on('connection', function (c) { net._adopt(c); });
		},

		join: function (code) {
			net.close();
			net.status = 'connecting';
			code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
			try {
				var peer = net._mkpeer(null, 0);
				peer.on('open', function () {
					net._adopt(peer.connect(PREFIX + code, { reliable: true }));
				});
			} catch (e) {
				net.status = 'error:networking unavailable';
			}
		},

		send: function (s) {
			try { if (net._conn && net._conn.open) net._conn.send(s); } catch (e) {}
		},

		drain: function () {
			if (net._queue.length === 0) return '[]';
			return JSON.stringify(net._queue.splice(0));
		},

		close: function () {
			// flush the channel before tearing the peer down, so a final "bye"
			// actually leaves the wire instead of dying in the send buffer
			try { if (net._conn && net._conn.open) net._conn.close({ flush: true }); } catch (e) {}
			var p = net._peer;
			if (p) {
				setTimeout(function () { try { p.destroy(); } catch (e) {} }, 250);
			}
			net._peer = null;
			net._conn = null;
			net._queue = [];
			net.status = 'idle';
			net.code = '';
		},
	};
	window.ffnet = net;
})();
