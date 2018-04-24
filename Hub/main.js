/*        _/_/                                            _/    _/  _/    _/  _/_/_/
       _/    _/  _/  _/_/    _/_/_/  _/    _/    _/_/_/  _/    _/  _/    _/  _/    _/
      _/_/_/_/  _/_/      _/    _/  _/    _/  _/_/      _/_/_/_/  _/    _/  _/_/_/
     _/    _/  _/        _/    _/  _/    _/      _/_/  _/    _/  _/    _/  _/    _/
    _/    _/  _/          _/_/_/    _/_/_/  _/_/_/    _/    _/    _/_/    _/_/_/
                             _/
                        _/_/

    All roads may lead to Rome, but all events go through here....
 */
'use strict';
String.prototype.pad = function (len,char,left) {
    left = (left || left===false) ? false : true;
    char    = ''+((char || (char===0)) ? char : ' ');                           //Force casting as a string
    let ps  = String(this);
    let its = len - ps.length;
    if (its>0) {
        for (let i=0; i<its; i++) {
            if (left) {
                ps = char+''+ps;
            } else {
                ps += char
            }
        }
    }
    return ps;
}
let fs      = require('fs');
let sslRoot = (process.platform === 'win32') ? '/apache/Apache24' : '/etc/apache2';
let key     = fs.readFileSync(sslRoot+'/ssl.key/dashboard.argusdentalvision.com.key');
let cert    = fs.readFileSync(sslRoot+'/ssl.crt/287a95a19db33aad.crt' );
let ca      = fs.readFileSync(sslRoot+'/ssl.crt/gd_bundle-g2-g1.crt' );
let app     = require('express')();
let mysql   = require('mysql');
let https   = require("https").createServer({ key:  key,  cert: cert,  ca:  ca },app).listen(3000,function () {
    console.log('If you are seeing this, the server started successfully...');
});
let io      = require('socket.io').listen(https);
let users       = { };
let sockets     = { };
let observers   = { };
let dentist     = false;
let flags       = {
    "patientWaiting": false,
    "patient": false
};

app.get('/', function (req,res) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-Requested-With");
    res.sendFile(__dirname+'/index.html');

});
app.use(function (req, res, next) {
    res.setHeader('Access-Control-Allow-Origin', 'https://dev.argusdentalvision.com');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
    res.setHeader('Access-Control-Allow-Credentials', true);
    // Pass to next layer of middleware
    next();
});
function routeMessage(message,data) {
    if (observers[message]) {
        for (var i in observers[message]) {
            io.to(i).emit(message,data);
        }
    }
}
io.on('connection', function (socket) {
    console.log(socket.id+' connected');
    io.to(this.id).emit('registerUserId');

    //=========================================================================
    //Basic connection events
    //=========================================================================
    socket.on('disconnect', function () {
        console.log(sockets[this.id]+' disconnected');
        if (this.id === flags.patient ) {
            flags.patient = false;
            flags.patientWaiting = false;
            io.emit('patientLeft');
        }
        let user_id = users[this.id];
        //Removing the user from tracking
        if (users[users[this.id]]) {
            delete users[sockets[this.id]];
        }
        if (sockets[this.id]) {
            delete sockets[this.id];
        }
        //Remove listeners tied to the user
        for (var listener in observers) {
            if (observers[listener][this.id]) {
                delete observers[listener][this.id];
            }
        }
        io.emit('userLoggedOut',{ 'user_id': user_id  });
    });

    /*
     * We are going to xref the socket to the user, and vice-versa
     */
    socket.on('logUserIn',function (data) {
        console.log('logging in user '+data.user_id);
        let socket_id = this.id;
        sockets[socket_id] = data.user_id;
        if (users[data.user_id]) {
            console.log('user is already logged in!');
            users[data.user_id][socket_id] = data.user_id; 
        } else {
            users[data.user_id] = { };
            users[data.user_id][socket_id] = data.user_id;
        }
        io.emit('userLoggedIn',{ "user_id": data.user_id } );
    });
    

    socket.on('showUsers',function () {
        let ctr = 0;
        console.log('');
        console.log('Active User Lists');
        console.log("Socket".pad(40)+"User ID".pad(20));
        console.log("=".pad(60,'='));
        for (var i in sockets) {
            console.log(i.pad(40)+''+sockets[i].pad(20));
            ctr++;
        }
        console.log("Currently "+ctr+" users are logged in");
    });
    
    socket.on('showListeners', function () {
        
    });
    
    /*
     * Instead of doing 'broadcast' messages, we are going to let clients register
     * which messages they are interested in listening for, and then
     */
    socket.on('registerListeners',function (listeners) {
        console.log(this.id+' registering listeners');
        for (var i in listeners) {
            if (!observers[listeners[i]]) {
                observers[listeners[i]] = { };
            }
            observers[listeners[i]][this.id] = true;
        }
        console.log(observers);
    });
    
   // socket.on('removeListeners',removeListeners);

    //specifically send to a particular user
    socket.on('RTCUserMessage',function (data) {
        if (users[this.id]) {
            io.to(this.id).emit(data.message,data);
        }
    });
    
    //broadcast to someone listening for a specific event
    socket.on('RTCMessageRelay', function (data) {
        console.log('RTC message: '+data.message);
        io.emit(data.message,data);
    });

    //=========================================================================
    //Text chat events
    //=========================================================================
    socket.on('chatMessage', function (msg) {
        io.emit('chat message',msg);
    });


    //=========================================================================
    //Teledentistry events
    //=========================================================================
    socket.on('patientEnteredWaitingRoom', function () {
        console.log('Someone just entered the waiting room');
        flags.patientWaiting = true;
        flags.patient        = this.id;
        io.emit('patientArrived');
    });

    socket.on('dentistLoggedOn', function () {
        console.log('The Dentist Is In');
        io.emit('dentistIsAvailable');
    });

    socket.on('patientLeftWaitingRoom', function () {
        console.log('Someone just left the waiting room');
        flags.patientWaiting = false;
        flags.patient = false;
        io.emit('patientLeft');
    });

    socket.on('patientWaitingCheck',function () {
        console.log('checking to see if a patient is waiting');
        if (flags.patientWaiting) {
            console.log('A patient is waiting');
            io.emit('patientWaiting');
        }
    });

    socket.on('dentistInitiatedCall', function (data) {
        console.log('Dentist Initiated Call');
        io.emit('dentistStartedFacetime',data);
    });

    socket.on('dentistTerminatedCall', function () {
        console.log('Dentist Hungup');
        io.emit('dentistHungup');
    });

    socket.on('newDentalSnapshot', function () {
        console.log('A dental wand image was taken');
        io.emit('newDentalSnapshot');
    });

    socket.on('teledentistryWandActivated', function () {
        console.log("The teledentistry wand is active");
        io.emit('teledentistryWandInUse');
    });

    socket.on('teledentistryFormChange',function (data) {
        console.log('The dental form has changed - '+data.form_id);
        io.emit('teledentistryFormUpdate',data);
    });

    socket.on('teledentistryToothPicked',function (data) {
        console.log('A tooth has been highlighted or deselected');
        io.emit('teledentistryToothChosen',data);
    });

});
