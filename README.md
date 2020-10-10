# Basic tracker server for A9G hardware tracker

This is the backend and web server for GPS tracking using a custom tracker like
[A9G tracker](http://blog.ivor.org/2020/10/tracking-running-part-2.html)

This is (heavilly) based on Michael Kleinhenz's tk-102 server code: [tk102b-server](https://github.com/michaelkleinhenz/tk102b-server) (but changes really aren't clean enough/sensible enough to justify a fork or pull request).

Only supports the homebrew tracker but it's straightforward to add on additional string checks for other tracker format messages and can be used to track (and switch between) multiple trackers.

The config.json files in both the root and static directories will need tuning for different device id's (the important bit is adding the IMEI, but this could be changed to allow the server to listen to all), server locations, ports etc.

Once done run, just:
``npm install
npm start``

Fire up the tracker and browse to the webpage.

![Screenshot](overview.jpg?raw=true "Screenshot")
