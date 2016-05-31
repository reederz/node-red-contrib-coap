var cbor = require("cbor");
var coap = require("coap");
var url = require("url");

var coapRequestNode = require("../coap/coap-request.js");
var injectNode = require("../node_modules/node-red/nodes/core/core/20-inject.js");

var should = require("should");
var helper = require("./helper.js");


// TODO:
// - should we move the test CoAP server creation to helper.js?

describe('CoapRequestNode', function() {
    var i;

    var lastPort = 8887;
    function getPort() {
        return ++lastPort;
    }

    beforeEach(function(done) {
        helper.startServer(done);
    });

    afterEach(function(done) {
        helper.unload().then(function() {
            helper.stopServer(done);
        });
    });

    it('should be loaded', function(done) {
        var flow = [
                    {
                        id: "coapRequest1",
                        type: "coap request",
                        "content-format": "application/json",
                        method: "POST",
                        name: "coapRequestPost",
                        observe: false,
                        url: "/test-resource",
                    },
                   ];

        helper.load([coapRequestNode], flow, function() {
            var coapRequest1 = helper.getNode("coapRequest1");
            coapRequest1.options.should.have.property('method', 'POST');
            coapRequest1.options.should.have.property('name', 'coapRequestPost');
            coapRequest1.options.should.have.property('observe', false);
            coapRequest1.options.should.have.property('url', '/test-resource');
            done();
        });
    });

    var methodTests = [
        { method: 'GET',    message: 'You get me, buddy' },
        { method: 'PUT',    message: 'This resource sucks–need to change it' },
        { method: 'POST',   message: 'Welcome aboard!' },
        { method: 'DELETE', message: 'Erase and rewind…' }
    ];

    for ( i = 0; i < methodTests.length; ++i ) {
        ( function ( test ) {
            it('should be able to make ' + test.method + ' requests', function(done) {
                var port = getPort();
                var flow = [
                            {
                                id: "inject",
                                type: "inject",
                                name: "inject",
                                payload: "",
                                payloadType: "none",
                                repeat: "",
                                crontab: "",
                                once: true,
                                wires: [["coapRequest"]],
                            },
                            {
                                id: "coapRequest",
                                type: "coap request",
                                "content-format": "text/plain",
                                method: test.method,
                                name: "coapRequest",
                                observe: false,
                                url: "coap://localhost:" + port + "/test-resource",
                            },
                           ];

                var testNodes = [coapRequestNode, injectNode];

                // let's make a CoAP server to respond to our requests (no matter how silly they are)
                var server = coap.createServer();
                server.on('request', function(req, res) {
                    res.setOption('Content-Format', 'text/plain');
                    if (req.url == "/test-resource" && req.method == test.method) {
                        res.end(test.message);
                    }
                });
                server.listen(port);

                helper.load(testNodes, flow, function() {
                    //Let's catch the response and compare the payload to the expected result.
                    var coapRequest = helper.getNode("coapRequest");
                    coapRequest.payloadDecodedHandler = function(payload) {
                        payload.toString().should.equal(test.message);
                        done();
                    };
                });
            });
        } ) ( methodTests[i] );
    }

    it('should get resource updates after making GET request with "Observe" header', function(done) {
        var port = getPort();
        // The flow:
        // - 2 fire-once inject nodes which are connected to 2 "coap request" nodes
        // - 4 "coap request" GET nodes with "Observe" option enabled which get triggered by their respective "inject" nodes
        var flow = [
                    {
                        id: "inject1",
                        type: "inject",
                        name: "Fire once (inject)",
                        payload: "",
                        payloadType: "none",
                        repeat: "",
                        crontab: "",
                        once: true,
                        wires: [["coapRequest1"]],
                    },
                    {
                        id: "coapRequest1",
                        type: "coap request",
                        "content-format": "text/plain",
                        method: "GET",
                        name: "coapRequestGetObserve1",
                        observe: true,
                        url: "coap://localhost:" + port + "/test-resource1",
                    },
                    {
                        id: "inject2",
                        type: "inject",
                        name: "Fire once (inject)",
                        payload: "",
                        payloadType: "none",
                        repeat: "",
                        crontab: "",
                        once: true,
                        wires: [["coapRequest2"]],
                    },
                    {
                        id: "coapRequest2",
                        type: "coap request",
                        "content-format": "text/plain",
                        method: "GET",
                        name: "coapRequestGetObserve2",
                        observe: true,
                        url: "coap://localhost:" + port + "/test-resource2",
                    },
                   ];

        // Response payloads
        var message1 = 'message1';
        var message2 = 'message2';

        // CoAP server with 2 observable resources
        var server = coap.createServer();
        server.on('request', function(req, res) {
            res.setOption('Content-Format', 'text/plain');
            function response1() {
                res.write(message1);
            }
            function response2() {
                res.write(message2);
            }
            if (req.headers.Observe !== 0) {
              return res.end('Response to a regular request\n');
            }

            var responseFn = null;
            if (req.url == "/test-resource1" && req.method == "GET") {
                responseFn = response1;
            }
            else if (req.url == "/test-resource2" && req.method == "GET") {
                responseFn = response2;
            }
            var interval = setInterval(responseFn, 10);

            res.on('finish', function(err) {
              clearInterval(interval);
            });
        });
        server.listen(port);

        var testNodes = [coapRequestNode, injectNode];

        helper.load(testNodes, flow, function() {
            var noUpdates1 = 0;
            var noUpdates2 = 0;
            var coapRequest1 = helper.getNode("coapRequest1");

            function testCompletion() {
                if (noUpdates1 == 3 && noUpdates2 == 3) {
                    done();
                }
            }

            coapRequest1.payloadDecodedHandler = function(payload) {
                payload.toString().should.equal(message1);
                noUpdates1++;
                testCompletion();
            };
            var coapRequest2 = helper.getNode("coapRequest2");
            coapRequest2.payloadDecodedHandler = function(payload) {
                payload.toString().should.equal(message2);
                noUpdates2++;
                testCompletion();
            };
        });

    });

    var serializeFormatTests = [
        {
            format: 'text/plain',
            message: 'this is a plain text message.',
            decode: function (buf) { return Promise.resolve(buf.toString()); }
        },
        {
            format: 'application/json',
            message: { thisIs: 'JSON' },
            decode: function (buf) { return Promise.resolve(JSON.parse(buf.toString())); }
        }
    ];

    for ( i = 0; i < serializeFormatTests.length; ++i ) {
        ( function (test) {
            it('should be able to serialize `' + test.format + '` request payload', function(done) {
                var port = getPort();

                var flow = [
                            {
                                id: "inject",
                                type: "inject",
                                name: "Fire once",
                                payload: test.message,
                                payloadType: "string",
                                repeat: "",
                                crontab: "",
                                once: true,
                                wires: [["coapRequest"]],
                            },
                            {
                                id: "coapRequest",
                                type: "coap request",
                                "content-format": test.format,
                                method: "POST",
                                name: "coapRequestPost",
                                observe: false,
                                url: "coap://localhost:" + port + "/test-resource",
                            }
                           ];

                var server = coap.createServer();
                server.on('request', function(req, res) {
                    try {
                        req.url.should.equal("/test-resource");
                        req.method.should.equal("POST");
                        req.headers['Content-Format'].should.equal(test.format);
                        test.decode(req.payload)
                            .then(function(val){ should.deepEqual(val, test.message); })
                            .then(done, done); // looks a bit like black magic, but works because the previous line returns `undefined`
                    } catch (e) { done(e); }
                });
                server.listen(port);

                var testNodes = [coapRequestNode, injectNode];
                helper.load(testNodes, flow);
            });
        } ) (serializeFormatTests[i]);
    }

    var deserializeFormatTests = [
        {
            format: 'text/plain',
            message: 'this is a plain text message.',
            encode: function (s) { return s; }
        },
        {
            format: 'application/json',
            message: { thisIs: 'JSON' },
            encode: JSON.stringify
        },
        {
            format: 'application/cbor',
            message: { thisIs: 'CBOR' },
            encode: cbor.encode
        },
        {
            format: 'application/link-format',
            message: linkFormat.parse('</r1>;if=foo;rt=bar,</r2>;if=foo;rt=baz;obs'),
            encode: function (lf) { return lf.toString(); }
        }
    ];

    for ( i = 0; i < deserializeFormatTests.length; ++i ) {
        ( function (test) {
            it('should be able to deserialize `' + test.format + '` response payload', function(done) {
                var port = getPort();

                var flow = [
                            {
                                id: "inject",
                                type: "inject",
                                name: "Fire once",
                                payload: "",
                                payloadType: "none",
                                repeat: "",
                                crontab: "",
                                once: true,
                                wires: [["coapRequest"]],
                            },
                            {
                                id: "coapRequest",
                                type: "coap request",
                                "content-format": test.format,
                                method: "GET",
                                name: "coapRequestGet",
                                observe: false,
                                url: "coap://localhost:" + port + "/test-resource",
                            }
                           ];

                var server = coap.createServer();
                server.on('request', function(req, res) {
                    req.url.should.equal("/test-resource");
                    req.method.should.equal("GET");
                    res.setOption('Content-Format', test.format);
                    res.end(test.encode(test.message));
                });
                server.listen(port);

                var testNodes = [coapRequestNode, injectNode];
                helper.load(testNodes, flow, function() {
                    //Let's catch the response and compare the payload to the expected result.
                    var coapRequest = helper.getNode("coapRequest");
                    coapRequest.payloadDecodedHandler = function(payload) {
                        var r = undefined;
                        try {
                            Buffer.isBuffer(payload).should.be.false;
                            should.deepEqual(payload, test.message);
                        } catch (e) { r = e; }
                        done(r);
                    };
                });
            });
        } ) (deserializeFormatTests[i]);
    }
});
