# Panzerchess online
1. Install Node 18+ on your host. 2. `node server.js` (set PORT if needed). 3. Open http://your-host:3000
Create a game, send the page link (it ends in #CODE) to your opponent, who opens it and presses Join.
No npm packages needed. Games live in server memory (restarting the server ends them) and expire after 6 idle hours.
Reconnect: refresh or reopen the same link on the same browser. Model tweaks (scale, barrel direction, turret height) are constants at the top of public/index.html.
"# panzerchess" 
