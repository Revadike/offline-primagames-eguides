# offline-primagames-eguides

![](https://primagames.com/localstatic/img/logo.png)

## Description
Download [your eGuides from PrimaGames](https://primagames.com/accounts/account/my_guides) for offline use.

## Requirements
 * [Node.js](https://nodejs.org/download/)
 * [EditThisCookie](http://www.editthiscookie.com/)

## Instructions
1. Download/clone repo
2. Run `npm install`
3. Edit `config.json` to change settings, like output path
4. [Login to PrimaGames](https://primagames.com/accounts/login)
5. Export your cookies with [EditThisCookie](http://www.editthiscookie.com/) and save them to `cookies.json`
6. Run `node index.js`

## Warning
Depending on your settings and number of guide, this can be very resource-intensive, since it runs a headless browser in the background.
Ensure you allocate enough system resources and space beforehand.