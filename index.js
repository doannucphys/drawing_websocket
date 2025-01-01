const app = require('express')()
const redis = require('redis');
const server = require('http').createServer(app);
const jwt = require('jsonwebtoken')
require("dotenv").config();

// for demo, allow all origin
var cors = require('cors')
app.use(cors())

// setup redis client
const client = redis.createClient({
    socket: {
      port: process.env.REDIS_PORT,
      host: process.env.REDIS_HOST,
    }
  });

// Connect to redis server
(async () => {
    await client.connect();
})();

// setup socket. For demo, allow all origin and not config for authentication
const io = require('socket.io')(server, {cors: {
    origin: "*"
}});

// const connections = [];
// init when 1 socket is activated
io.use(function(socket, next){
    const { token } = socket.handshake.auth;
    if (token){
        jwt.verify(token, process.env.JWT_SECRET, function(err, decoded) {
        if (err) {
            return next(new Error('Socket authentication error'));
        }
        socket.decoded = decoded;
        next();
    });
  }
  else {
    next(new Error('Socket authentication error'));
  }    
})
.on('connection', (socket) => {
    // connections.push(socket);
    socket.on('disconnect', async () => {
        // connections.splice(connections.indexOf(socket), 1);
        const socketInfo = JSON.parse(await client.get(`socket_${socket.id}`));
        if (socketInfo) {
            // delete cache redis connect info
            await client.del(`class_${socketInfo.classId}_user_${socketInfo.username}`)
            io.to(`chanel_${socketInfo.classId}`).emit('user_leave', {classId: socketInfo.classId, username: socketInfo.username});
            await client.del(`socket_${socket.id}`)
        }
    });

    socket.on('reconnect', async data => {
        socket.join(`chanel_${data.classId}`);
        io.to(`chanel_${data.classId}`).emit('user_reconnect', {classId: data.classId, username: data.username});
        await client.set(`class_${data.classId}_user_${data.username}`, data.username)
        await client.set(`socket_${socket.id}`, JSON.stringify({classId: data.classId, username: data.username}))
    })

    // when new user registers
    socket.on('register', async data => {
        // cache redis connect info
        client.set(`socket_${socket.id}`, JSON.stringify({classId: data.classId, username: data.username}))
        socket.join(`chanel_${data.classId}`);

        // push data to redis cache
        client.set(`class_${data.classId}_user_${data.username}`, data.username)

        // emit back to connected user
        socket.emit('register_success');
    })

    // when user open canvas to start drawing
    socket.on('open_drawing_canvas', data => {
        // emit event to all other connected users includes current user for updating leaderboard
        io.to(`chanel_${data.classId}`).emit('new_user_start_drawing', {classId: data.classId, username: data.username });
    })

    // user make draw action
    socket.on('draw', data => {
        // push data to redis cache. Not care about order of stroke, so Set random number in key 
        client.set(`class_${data.classId}_strokes_${Math.random()}`, JSON.stringify(data.strokes))
        io.to(`chanel_${data.classId}`).emit('update_draw_canvas', data);
    });
});

// get user list for 1 class when use refresh screen draw 
app.get('/class/:id/users', async(req, res) => {
    const id = req.params.id;
    const keys = await client.keys(`class_${id}_user*`)
    const data = await Promise.all(
        keys.map(async(key, id) => {
                const username = await client.get(key) || '';
                return {id, username}
            })
    )
    .then(values => {
        return values
    });
    res.send(data)
})

// get stroke list of canvas for 1 class when use refresh screen draw 
app.get('/class/:id/strokes', async(req, res) => {
    const id = req.params.id;
    const keys = await client.keys(`class_${id}_strokes*`)
    const data = await Promise.all(keys.map(async(key, id) => JSON.parse(await client.get(key)) )).then(values => {
        return values
    });
    res.send(data.map(e => e[0]))
})

// start server
server.listen(process.env.PORT || 3000, () => {
    console.log('listent at: 3000...')
})
