'use strict';
var EasyRTC = (function () {
    //variables that can be "elevated" to a semi-global scope relative the object are placed up here
    let EasyRTCs        = { };
    let mediaStream     = { };
    let socket          = false;
    let pc              = { };
    let players         = { };
    let defaults        = {
        "events": {
            "offer": {
                "inbound": "inboundOffer",
                "outbound": "outboundOffer"
            },
            "answer": {
                "inbound": "inboundAnswer",
                "outbound": "outboundAnswer"
            },
            "candidate": {
                "inbound": "inboundCandidate",
                "outbound": "outboundCandidate"
            },
            "negotiation": {
                "inbound": "inboundNegotiation",
                "outbound": "outboundNegotiation"
            }
        },
        "configuration": {
            iceServers: [
                {
                    urls: "stun:stun.l.google.com:19302"
                }
            ],
            turnServers: [
            ]            
        },
        "options": {
            offerToReceiveAudio: 1,
            offerToReceiveVideo: 1            
        },
        "constraints": {
            audio: true,
            video: true      
        }
    };
    function output(m) {
        return function (e) {
            console.log('EasyRTC: '+m);
            if (e) {
                console.log(e);
            }
        };
    }
    function scrubEvents(events) {
        this.events.offer        = (events.offer) ? this.events.offer : defaults.events.offer;
        this.events.answer       = (events.answer) ? this.events.answer : defaults.events.answer;
        this.events.candidate    = (events.candidate) ? this.events.candidate : defaults.events.candidate;
        this.events.negotiation  = (events.negotiation) ? this.events.negotiation : defaults.events.negotiation;
        return events;
    }
    function scrubConstraints(constraints) {
        constraints.audio = (constraints.audio || constraints.audio === false || constraints.audio === 0) ? constraints.audio : defaults.constraints.audio;
        constraints.video = (constraints.video || constraints.video === false || constraints.video === 0) ? constraints.video : defaults.constraints.video;
        return constraints;
    }
    function scrubOfferOptions(options) {
        options.offerToRecieveAudio = (options.offerToReceiveAudio || options.offerToReceiveAudio === false || options.offerToReceiveAudio === 0) ? options.offerToReceiveAudio  : defaults.options.offerToReceiveAudio;
        options.offerToRecieveVideo = (options.offerToRecieveVideo || options.offerToRecieveVideo === false || options.offerToRecieveVideo === 0) ? options.offerToRecieveVideo  : defaults.options.offerToRecieveVideo;
        return options;
    }
    function scrubConfiguration(config) {
        config.iceServers   = (config.iceServers)   ? config.iceServers  : defaults.configuration.iceServers;
        config.turnServers  = (config.turnServers)  ? config.turnServers : defaults.configuration.turnServers;
        return config;
    }
    function init(id,configuration,constraints) {
        pc[id] = new RTCPeerConnection(configuration);  
        mediaStream[id] = false;
        navigator.mediaDevices.getUserMedia(constraints).then(function(stream) {
            stream.getTracks().forEach(
                function(track) {
                    pc[id].addTrack(track,stream);
                }
            );
            mediaStream[id] = stream;
        }).catch(
            output('Failed to initialize stream')
        );
        return true;
    };
    let RTC     = {
        prepped:        false,
        initialized:    false,
        mediaStream:    false,
        readyFunc:      false,
        defaults:   function () {
            return defaults;
        },
        ready: function (func) {
            //This is an implementation of a poor-mans Promise.  Used this way because ES6 is not guaranteed.
            //When the media stream is ready, it will autoplay.
            if (func) {
                this.readyFunc = func;
            }
            if (mediaStream[this.id] !== false) {
                //assert true!
                this.readyFunc();
            } else {
                let me = this;
                window.setTimeout(function () { me.ready(); },50);
            }
            return (mediaStream[this.id] !== false);
        },
        prep: function () {
            let me = this;
            pc[this.id].ontrack = function (evt) {
                players[me.id].srcObject = evt.streams[0];
            } ;            
            pc[this.id].oniceconnectionstatechange = function(e) {
            };
            pc[this.id].onnegotiationneeded = function (e) {
                console.log('negotiation required');
                this.createOffer().then(function (offer) {
                    return pc[me.id].setLocalDescription(offer);
                }).then(function () {
                    socket.emit('RTCMessageRelay',{ "message": me.events.negotiation.inbound, "type": "offer", "desc": this.localDescription });
                }).catch(output('Error during negotiation'));

            };
            pc[this.id].onicecandidate = function(e) {
                socket.emit("RTCMessageRelay",{ "message": me.events.candidate.inbound, "id": socket.id, "candidate": e.candidate });
            };
            socket.on(this.events.offer.inbound,function (offer) {
                if (offer.id !== socket.id) {
                    pc[me.id].setRemoteDescription(offer.offer).then(function (answer) {
                        pc[me.id].createAnswer(answer).then(function (response) {
                            pc[me.id].setLocalDescription(response).then(function () {
                                socket.emit('RTCMessageRelay',{ "message": me.events.answer.inbound, "id": socket.id, "answer": response });
                            });
                        }).catch(
                            output('failed local set on my side')
                        );
                    }).catch(
                        output('failed remote set')
                    );
                } else {
                    console.log('ignoring my own offer');
                }                
            });
            socket.on(this.events.answer.inbound,function (response) {
                if (response.id !== socket.id) {
                    console.log('setting remote description ');
                    pc[me.id].setRemoteDescription(response.answer).catch(
                        output('no dice')
                    );
                } else {
                    console.log('Ignoring my own answer');
                }
            });
            socket.on(this.events.candidate.inbound,function (e) {
                if ((e.id !== socket.id) && (e.candidate)) {
                    pc[me.id].addIceCandidate(e.candidate).catch(
                        output('failed adding candidate!')
                    );
                } 
            });            
            this.prepped = true;
        },
        play: function () {
            if (!this.prepped) {
                this.prep();
            }
            players[this.id]                    = $E('video_player_'+this.id);
            players[this.id].srcObject          = mediaStream[this.id];
            players[this.id].onloadedmetadata   = function(e) {
                this.play();
            };
        },
        call: function () {
            let me      = this;
            if (!players[this.id]) {
                this.play();
            }
            pc[this.id].createOffer(this.offerOptions).then(function (offerData) {
                pc[me.id].setLocalDescription(offerData).then(function (data) {
                    socket.emit('RTCMessageRelay',{ "message": me.events.offer.inbound, 'id': socket.id, 'offer': offerData });
                }).catch(
                    output('Failed setting local description') 
                );
            });              
        },
        hangup: function () {
            mediaStream[this.id].getTracks().forEach(function (track) {
                track.stop();
            });
            if (pc[this.id] && pc[this.id].close) {
                pc[this.id].close();
            }
            if (players[this.id] && players[this.id].srcObject) {
                players[this.id].srcObject = null;
            }
                
        }
    };
    return {
        /* This method takes the arguments passed and 'scrubs' them, allowing you to run with defaults but only change the part of the configuration you want, and not have to pass in an entire configuration array */
        get: function (identifier,websocket,configuration,constraints,options,evts) {
            socket          = (!socket) ? websocket : socket;
            events          = (evts)            ? scrubEvents(evts)                 : defaults.events;
            constraints     = (constraints)     ? scrubConstraints(constraints)     : defaults.constraints;
            offerOptions    = (options)         ? scrubOfferOptions(options)        : defaults.options;
            configuration   = (configuration)   ? scrubConfiguration(configuration) : defaults.configuration;
            return (EasyRTCs[identifier])       ? EasyRTCs[identifier] : (EasyRTCs[identifier] = Object.create(RTC,{"id": { "value": identifier }, "offerOptions": { "value": offerOptions }, "events": { "value": events}, 'initialized': { "value": init(identifier,configuration,constraints) } } ));
        }
    };
})();
