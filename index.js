const IO = require("fs-extra");
const PDFMerger = require("pdf-merger-js");
const Throttle = require("promise-parallel-throttle");
const Puppeteer = require("puppeteer");
const { keepTemp, maxInProgress, maxRetries, minBytes, outputPath, overwrite } = require("./config.json");

async function newPage(browser, cookies) {
    let page = await browser.newPage();
    await page.setJavaScriptEnabled(true);
    await page.setDefaultNavigationTimeout(90000);
    await page.setCookie(...cookies.map(c => ({ "name": c.name, "value": c.value, "domain": c.domain, "path": c.path })));
    if (page.emulateMedia) {
        await page.emulateMedia("print");
    } else if (page.emulateMediaType) {
        await page.emulateMediaType("print");
    }
    return page;
}

async function ensureGoTo(page, url, retries = 0) {
    let retry = retries;
    let response = await page.goto(url, { "waitUntil": "networkidle0" }).catch(() => false);

    while (response && response.status() !== 200 && retry < maxRetries) {
        if (page.waitForTimeout) {
            await page.waitForTimeout(10000);
        } else {
            await page.wait(10000);
        }
        retry++;
        response = await page.reload().catch(() => false);
    }

    if (!response && retry < maxRetries) {
        if (page.waitForTimeout) {
            await page.waitForTimeout(10000);
        } else {
            await page.wait(10000);
        }
        let newPage = await ensureGoTo(page, url, ++retry);
        return newPage;
    }

    return retry < maxRetries ? page : false;
}

async function ensurePDFSize(page, path, height, width) {
    if (page.waitForTimeout) {
        await page.waitForTimeout(1000);
    } else {
        await page.wait(1000);
    }
    await page.pdf({ path, height, width, "printBackground": true });

    let retries = 0;
    let { size } = await IO.stat(path);
    while (size < minBytes && retries < maxRetries) {
        if (page.waitForTimeout) {
            await page.waitForTimeout(1000);
        } else {
            await page.wait(1000);
        }
        await page.pdf({ path, height, width, "printBackground": true, "timeout": 300000 });

        retries++;
        ({ size } = await IO.stat(path));
    }

    return retries >= maxRetries;
}

async function convertToPDF(tab, url, name, i, stylesheet) {
    let filename = `${i}.pdf`;
    let path = `${outputPath}/${name}/${filename}`;

    if (!overwrite && await IO.pathExists(path)) {
        return path;
    }

    await IO.ensureDir(path.replace(filename, ""));
    let page = await ensureGoTo(tab, url);
    if (!page) {
        return false;
    }

    await page.addStyleTag({ "content": stylesheet });
    let { height, width } = await page.evaluate(() => {
        let result = {
            "height": {
                "value":     0,
                "estimated": false
            },
            "width": {
                "value":     0,
                "estimated": false
            }
        };

        let article = document.querySelector("#content article");
        if (article) {
            result.height.value = article.scrollHeight;
            result.width.value = article.scrollWidth;
        } else {
            result.height.estimated = true;
            result.width.estimated = true;
            let main = document.querySelector("[tabindex=\"0\"]");
            let content = document.querySelector("#content");
            // best height estimate:
            result.height.value = Math.max(
                main ? main.scrollHeight : 0,
                content ? content.scrollHeight : 0,
                document.body.scrollHeight
            );
            // best width estimate:
            result.width.value = Math.max(
                main ? main.scrollWidth : 0,
                content ? content.scrollWidth : 0,
                document.body.scrollWidth
            );
        }

        let header = document.querySelector("body > header");
        if (header) {
            result.height.value += header.scrollHeight;
        } else {
            result.height.estimated = true;
            result.height.value += 90; // header estimated height
        }

        result.height.value += 35; // 35 is bottom margin of article
        result.height.value += "px";
        result.width.value += "px";
        return result;
    });

    if (height.estimated) {
        console.log(`Notice - The following page has a non-standard height: ${url}`);
    }

    if (width.estimated) {
        console.log(`Notice - The following page has a non-standard width: ${url}`);
    }

    await ensurePDFSize(page, path, height.value, width.value);
    return path;
}

async function scrapeGuide(guide, browser, cookies, stylesheet) {
    let { url, title } = guide;
    let path = `${outputPath}/${title}.pdf`;
    if (!overwrite && await IO.pathExists(path)) {
        console.log(path);
        return;
    }

    let merger = new PDFMerger();
    merger.loadOptions = {
        "ignoreEncryption":     true,
        "throwOnInvalidObject": false
    };
    let page = await newPage(browser, cookies);
    page = await ensureGoTo(page, url);
    if (!page) {
        console.log(`Failed to fetch ${url}`);
        return;
    }

    let pages = await page.evaluate(() => [...document.querySelectorAll("#toc a[data-section-id]")].map(e => e.href));
    if (pages.length === 0) {
        console.log(`No pages found for ${title}`);
        return;
    }

    for (let i = 1; i <= pages.length; i++) {
        let path = await convertToPDF(page, pages[i - 1], title, i, stylesheet);
        if (path) {
            merger.add(path);
            console.log(path);
        } else {
            console.log(`Failed to convert to pdf ${pages[i - 1]}`);
        }
    }

    if (page.waitForTimeout) {
        await page.waitForTimeout(2000);
    } else {
        await page.wait(2000);
    }
    await merger.save(path);
    await page.close();
    console.log(path);

    if (!keepTemp) {
        await IO.remove(`${outputPath}/${title}/`);
    }
}

(async() => {
    const stylesheet = await IO.readFile("stylesheet.css", "utf8");
    const cookies = await IO.readJSON("cookies.json");
    const browser = await Puppeteer.launch();

    let page = await newPage(browser, cookies);
    page = await ensureGoTo(page, "https://eguides.primagames.com/accounts/account/my_guides");
    if (!page) {
        throw new Error("Unable to fetch PrimaGames eGuides");
    }

    let guides = await page.evaluate(() => [...document.querySelectorAll("a.cover")].map(e => ({
        "url":   e.href,
        "title": e.nextSiblings(".title")[0].innerText.replace(/[^A-Za-z0-9 ]+/g, "").replace(/[ ]+/g, " ")
    })));

    await page.close();
    console.log(`Found ${guides.length} eGuides`);

    await Throttle.all(guides.map(guide => () => scrapeGuide(guide, browser, cookies, stylesheet)), { maxInProgress });
    await browser.close();
    process.exit(0);
})().catch(err => {
    console.log(err);
    process.exit(1);
});
