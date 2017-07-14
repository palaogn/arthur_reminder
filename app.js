var express = require("express");
var request = require("request");
var bodyParser = require("body-parser");

var app = express();
app.use(bodyParser.urlencoded({extended: false}));
app.use(bodyParser.json());
app.listen((process.env.PORT || 5000));


// Server index page
app.get("/", function (req, res) {
  res.send("Arthur is alive!");
});


// Facebook Webhook
// Used for verification
app.get("/webhook", function (req, res) {
  if (req.query["hub.verify_token"] === "mango") {
    console.log("Verified webhook");
    res.status(200).send(req.query["hub.challenge"]);
  } else {
    console.error("Verification failed. The tokens do not match.");
    res.sendStatus(403);
  }
});

// All callbacks for Messenger will be POST-ed here
app.post("/webhook", function (req, res) {
  // Make sure this is a page subscription
  if (req.body.object == "page") {
    // Iterate over each entry
    // There may be multiple entries if batched
    req.body.entry.forEach(function(entry) {
      // Iterate over each messaging event
      entry.messaging.forEach(function(event) {
        if (event.postback) {
          processPostback(event);
        } else if (event.message) {
          processMessage(event);
        }
      });
    });

    res.sendStatus(200);
  }
});

function processPostback(event) {
  var senderId = event.sender.id;
  var payload = event.postback.payload;

  if (payload == "Greeting") {
    // Get user's first name from the User Profile API
    // and include it in the greeting
    request({
      url: "https://graph.facebook.com/v2.6/" + senderId,
      qs: {
        access_token: process.env.PAGE_ACCESS_TOKEN,
        fields: "first_name"
      },
      method: "GET"
    }, function(error, response, body) {
      var greeting = "";
      if (error) {
        console.log("Error getting user's name: " +  error);
      } else {
        var bodyObj = JSON.parse(body);
        name = bodyObj.first_name;
        greeting = "Hi " + name + ". ";
      }
      var message = greeting + "My name is Arthur and I can send you a reminder every day.";
      sendMessage(senderId, {text: message});

      message = {
        "attachment":{
          "type":"template",
          "payload":{
            "template_type":"button",
            "text":"Do you want to get reminders?",
            "buttons":[
              {
                "type":"postback",
                "title":"Yes",
                "payload":"ChangeTimeYES"
              },
              {
                "type":"postback",
                "title":"No",
                "payload":"ChangeTimeNO"
              }
            ]
          }
        }
      }
      sendMessage(senderId, message);
    });
  }
  else if (payload == "ChangeTimeYES") {
	  sendMessage(senderId, {text: "your response was yes"});
	   message = {
        "attachment":{
          "type":"template",
          "payload":{
            "template_type":"button",
            "text":"Do you want to get reminders?",
            "buttons":[
              {
                "type":"postback",
                "title":"Yes",
                "payload":"ChangeTimeYES"
              },
              {
                "type":"postback",
                "title":"No",
                "payload":"ChangeTimeNO"
              }
            ]
          }
        }
      }
      sendMessage(senderId, message);	
    //updateDatabase();
  }
  else if (payload == "ChangeTimeNO"){
    sendMessage(senderId, {text: "Alright, then we will not change the time"});
  }
  else if(payload == "TimeOne" || payload == "TimeTwo" || payload == "TimeThree" || payload == "TimeFour"){
	sendMessage(senderId, {text: "Alright, then we will send you reminder at that time"});
  }
}

function processMessage(event) {
  if (!event.message.is_echo) {
    var message = event.message;
    var senderId = event.sender.id;

    console.log("Received message from senderId: " + senderId);
    console.log("Message is: " + JSON.stringify(message));

    // You may get a text or attachment but not both
    if (message.text) {
      var formattedMsg = message.text.toLowerCase().trim();

      //checks if these words are in the message and replies.
      switch (formattedMsg) {
        case String(formattedMsg.match(/.*hi.*/)):
        case String(formattedMsg.match(/.*hello.*/)):
        case String(formattedMsg.match(/.*good morning.*/)):
          sendMessage(senderId, {text: "Hey there"});
          break;
        case String(formattedMsg.match(/.*change.*/)):
        case String(formattedMsg.match(/.*schedule.*/)):
        case String(formattedMsg.match(/.*date.*/)):
          sendMessage(senderId, {text: "You want to change time"});
          break;

        default:
          sendMessage(senderId, {text: "Sorry, did not get that, can you try again"});
      }
    } else if (message.attachments) {
      sendMessage(senderId, {text: "Sorry, I don't understand your request."});
    }
  }
}

// sends message to user
function sendMessage(recipientId, message) {
  request({
    url: "https://graph.facebook.com/v2.6/me/messages",
    qs: {access_token: process.env.PAGE_ACCESS_TOKEN},
    method: "POST",
    json: {
      recipient: {id: recipientId},
      message: message,
    }
  }, function(error, response, body) {
    if (error) {
      console.log("Error sending message: " + response.error);
    }
  });
}

function updateDatabase() {
  //is this a real time

  //does id exist, then change time

  //add id and time to db
}
