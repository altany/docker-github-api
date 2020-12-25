"use strict";

const express = require("express");
const path = require("path");
const cors = require("cors");

// Constants
const PORT = process.env.PORT || 8080;

const requestExt = require("request-extensible");
const RequestHttpCache = require("request-http-cache");

const httpRequestCache = new RequestHttpCache({
  max: 10 * 1024 * 1024, // Maximum cache size (1mb) defaults to 512Kb
  ttl: 7200,
});

const request = requestExt({
  extensions: [httpRequestCache.extension],
});

const clientID = process.env.GITHUB_CLIENTID || "";
const clientSecret = process.env.GITHUB_SECRET || "";

const host = "https://api.github.com/";
const repo = "altany";
const auth = new Buffer(`${clientID}:${clientSecret}`).toString("base64");
const apiVersion = "v3";

let options = {
  headers: {
    "User-Agent": repo,
    Authorization: `Basic ${auth}`,
    Accept: `application/vnd.github.${apiVersion}.raw+json`,
  },
};

let marked = require("marked");
let timeAgo = require("node-time-ago");

marked.setOptions({
  renderer: new marked.Renderer(),
  gfm: true,
  tables: true,
  breaks: false,
  pedantic: false,
  sanitize: false,
  smartLists: true,
  smartypants: false,
});

function formatErrorResponse({
  response,
  message = "",
  repo,
  code = 500,
  contentType = "text/plain",
} = {}) {
  response.statusCode = code;
  response.setHeader("Content-Type", contentType);
  return response.end(message + (repo ? ' for repo "' + repo + '"' : ""));
}

// App
const app = express();
app.use(cors());

app.get("/", function (req, res) {
  res.sendFile(path.join(__dirname + "/welcome.html"));
});

app.get("/repos", function (req, res) {
  options.url = `${host}users/${repo}/repos?sort=created`;
  request(options, function (error, response, body) {
    if (error) {
      return formatErrorResponse({ response: res, message: error });
    } else if (response.statusCode !== 200) {
      return formatErrorResponse({
        response: res,
        message: response.body,
        code: response.statusCode,
        contentType: "application/javascript",
      });
    }
    res.setHeader("Content-Type", "application/json");
    res.end(body);
  });
});

app.get("/readme/:repo", function (req, res) {
  options.url = `${host}repos/${repo}/${req.params.repo}/contents/README.md`;
  request(options, function (error, response, body) {
    if (error) {
      return formatErrorResponse({
        response: res,
        message: error,
        repo: req.params.repo,
      });
    }
    if (response.statusCode === 404) {
      return formatErrorResponse({
        response: res,
        message: "README.md not found",
        repo: req.params.repo,
        code: 404,
      });
    } else if (response.statusCode !== 200) {
      return formatErrorResponse({
        response: res,
        message: response.body,
        repo: req.params.repo,
        code: response.statusCode,
        contentType: "text/html",
      });
    } else {
      res.setHeader("Content-Type", "text/html");
      res.end(marked(body).toString());
    }
  });
});

app.get("/last-commit/:repo", function (req, res) {
  options.url = `${host}repos/${repo}/${req.params.repo}/commits`;
  request(options, function (error, response, body) {
    if (error) {
      return formatErrorResponse({
        response: res,
        message: error,
        repo: req.params.repo,
      });
    }
    let result = {};
    if (response.statusCode === 404) {
      return formatErrorResponse({
        response: res,
        message: "Commit history not found",
        repo: req.params.repo,
        code: 404,
      });
    } else if (response.statusCode !== 200) {
      return formatErrorResponse({
        response: res,
        message: response.body,
        repo: req.params.repo,
        code: response.statusCode,
        contentType: "text/html",
      });
    } else {
      let commit = JSON.parse(body)[0];
      result = {
        link: commit.html_url,
        date: timeAgo(commit.commit.author.date),
        message: commit.commit.message,
      };
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(result));
  });
});

app.get("/languages/:repo", function (req, res) {
  options.url = `${host}repos/${repo}/${req.params.repo}/languages`;
  request(options, function (error, response, body) {
    if (error) {
      return formatErrorResponse({
        response: res,
        message: error,
        repo: req.params.repo,
      });
    }
    if (response.statusCode === 404) {
      return formatErrorResponse({
        response: res,
        message: "languages not found",
        repo: req.params.repo,
        code: 404,
      });
    } else if (response.statusCode !== 200) {
      return formatErrorResponse({
        response: res,
        message: response.body,
        repo: req.params.repo,
        code: response.statusCode,
        contentType: "text/html",
      });
    } else {
      res.setHeader("Content-Type", "application/json");
      res.end(body);
    }
  });
});

app.use(function (req, res, next) {
  let err = new Error("Not Found");
  err.status = 404;
  next(err);
});
app.use(function (err, req, res, next) {
  res.sendStatus(err.status || 500);
});

app.listen(PORT);
console.log("Running on http://localhost:" + PORT);
