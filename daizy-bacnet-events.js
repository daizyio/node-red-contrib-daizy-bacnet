let Mqtt = require('mqtt');
const NodeCache = require( "node-cache" );

const messageCache = new NodeCache({
  stdTTL: 3600, // 1 hour
  checkperiod: 1800 // 30 minutes
});

let createTopicPrefix = `/out/bacnet/create/`;
let updateTopicPrefix = `/out/bacnet/update/`;
let deleteTopicPrefix = `/out/bacnet/delete/`;

module.exports = function(RED) {
  "use strict";

  let level;
  
  try {
    level = RED.log[RED.settings.logging.console.level.trim().toUpperCase()];
  } catch {
    level = 0;
  }

  if (!level || level >= RED.log.DEBUG) {
    messageCache.on( "expired", function ( key, value ) {
      const [nodeId, eventId] = key.split('_');
      RED.log.debug(`[daizy events:${nodeId}] Entry expired in the debounce cache for eventId:${eventId} with messageId: ${value}`);
    });
  }

  RED.nodes.registerType("daizy bacnet events", DaizyBacnetEvents, {
    credentials : {
      token : { type: 'text' }
    }
  });

  function DaizyBacnetEvents(n) {
    RED.nodes.createNode(this, n);
    if (!this.connection) {
      this.connect(n.token, n.endpoint);
    }
  }

  DaizyBacnetEvents.prototype.connect = function(token, endpoint) {
    if (token === "" ) {
      this.status(this.UNAUTHORIZED);
    } else {
      this.status(this.SUBSCRIBING);
      if (!this.connection) {
        try {
          const clientId = `nodered-${token.substring(0, 8)}-${this.id}`;
          this.log(`Connecting ${clientId}`);
          this.connection = Mqtt.connect(endpoint, {
            username: token,
            password: token,
            clientId,
            clean: false,
            keepalive: 180,
            reconnectPeriod: 60000
          });

          var self = this;

          this.connection.on('connect', function() {
            let devTopic = 'events';
            if (endpoint == 'wss://mqtt-test.daizy.io') {
              devTopic = 'events-dev';
            }
            const createTopic = devTopic + createTopicPrefix + token;
            const updateTopic = devTopic + updateTopicPrefix + token;
            const deleteTopic = devTopic + deleteTopicPrefix + token;
            self.connection.subscribe(createTopic, { qos: 1 });
            self.log(`Daizy ready to go! (${clientId} subscribed to ${createTopic})`);
            self.connection.subscribe(updateTopic, { qos: 1 });
            self.log(`Daizy ready to go! (${clientId} subscribed to ${updateTopic})`);
            self.connection.subscribe(deleteTopic, { qos: 1 });
            self.log(`Daizy ready to go! (${clientId} subscribed to ${deleteTopic})`);
            self.status(self.SUBSCRIBED);
          });

          this.connection.on('error', function(err) {
            self.error('Something went wrong', err)
            self.status(self.ERROR);
          })

          this.connection.on('close', function (err) {
            self.warn('Connection was closed')
            self.status(self.ERROR)
          })

          this.connection.on('message', function (topic, payload) {
            payload = JSON.parse(payload);
            self.log(`Received message for topic ${topic}, with messageId: ${payload.messageId} and eventId: ${payload.eventId}`);
            if (payload.eventId) {
              self.debug(`Checking debounce cache for eventId: ${payload.eventId}`);
              if (messageCache.has(`${self.id}_${payload.eventId}`)) {
                self.log(`eventId: ${payload.eventId} exists in debounce cache - dropping message...`);
                return;
              } else {
                self.log(`eventId: ${payload.eventId} is not in debounce cache, caching and processing message...`);
                messageCache.set(`${self.id}_${payload.eventId}`, payload.messageId);
              }
            } else {
              self.warn(`Message does not contain eventId so cannot check debounce cache...`);
            }
            self.send({
              topic : topic,
              payload : payload
            });
          });

        } catch (e) {
          this.error('Something went wrong', e)
          this.status(this.ERROR)
        }
      }
    }
  };

  DaizyBacnetEvents.prototype.close = function() {
    if(this.connection) {
      this.log("Disconnecting")
      this.connection.end()
    }
  }

  DaizyBacnetEvents.prototype.SUBSCRIBING = {
    fill : "yellow",
    shape : "ring",
    text : "subscribing..."
  }

  DaizyBacnetEvents.prototype.SUBSCRIBED = {
    fill : "green",
    shape : "ring",
    text : "subscribed"
  }

  DaizyBacnetEvents.prototype.ERROR = {
    fill : "red",
    shape : "ring",
    text : "Error"
  }

  DaizyBacnetEvents.prototype.UNAUTHORIZED = {
    fill : "red",
    shape : "ring",
    text : "Invalid Token"
  }

};
