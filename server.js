"use strict";

const express = require("express");
const path = require("path");
const cors = require("cors");
const requestExt = require("request-extensible");
const RequestHttpCache = require("request-http-cache");
const timeAgo = require("node-time-ago");
const marked = require("marked");

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

// Constants
const PORT = process.env.PORT || 8080;
const CLIENT_ID = process.env.GITHUB_CLIENTID || "";
const CLIENT_SECRET = process.env.GITHUB_SECRET || "";

const HOST = "https://api.github.com/";
const OWNER = "altany";
const AUTHORISATION = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString(
  "base64"
);
const API_VERSION = "v3";

const httpRequestCache = new RequestHttpCache({
  max: 10 * 1024 * 1024, // Maximum cache size (1mb) defaults to 512Kb
  ttl: 7200,
});

const request = requestExt({
  extensions: [httpRequestCache.extension],
});

let options = {
  headers: {
    "User-Agent": OWNER,
    Authorization: `Basic ${AUTHORISATION}`,
    Accept: `application/vnd.github.${API_VERSION}.raw+json`,
  },
};

const formatErrorResponse = ({
  response,
  message = "",
  repo,
  code = 500,
  contentType = "text/plain",
} = {}) => {
  response.statusCode = code;
  response.setHeader("Content-Type", contentType);
  return response.end(message + (repo ? ' for repo "' + repo + '"' : ""));
};

const sumObjectsByKeys = (...objects) =>
  objects.reduce((object1, object2) => {
    for (let property in object2) {
      if (object2.hasOwnProperty(property))
        object1[property] = (object1[property] || 0) + object2[property];
    }
    return object1;
  }, {});

const getRepos = (res) => {
  console.log("Getting all repos");
  return new Promise((resolve, reject) => {
    options.url = `${HOST}users/${OWNER}/repos?sort=created`;
    request(options, (error, response, body) => {
      if (error) {
        reject(formatErrorResponse({ response: res, message: error }));
      } else if (response.statusCode !== 200) {
        reject(
          formatErrorResponse({
            response: res,
            message: response.body,
            code: response.statusCode,
            contentType: "application/javascript",
          })
        );
      }
      resolve(body);
    });
  });
};

const getRepoLanguages = (repo, res) => {
  console.log(`Getting languages for repo ${repo}`);
  return new Promise((resolve, reject) => {
    options.url = `${HOST}repos/${OWNER}/${repo}/languages`;
    request(options, (error, response, body) => {
      if (error) {
        reject(
          formatErrorResponse({
            response: res,
            message: error,
            repo: repo,
          })
        );
      }
      if (response.statusCode === 404) {
        reject(
          formatErrorResponse({
            response: res,
            message: "languages not found",
            repo: repo,
            code: 404,
          })
        );
      } else if (response.statusCode !== 200) {
        reject(
          formatErrorResponse({
            response: res,
            message: response.body,
            repo: repo,
            code: response.statusCode,
            contentType: "text/html",
          })
        );
      } else {
        resolve(body);
      }
    });
  });
};

// App
const app = express();
app.use(cors());

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname + "/welcome.html"));
});

app.get("/repos", (req, res) => {
  getRepos(res)
    .then((response) => {
      res.setHeader("Content-Type", "application/json");
      res.send(response);
    })
    .catch((error) => error);
});

app.get("/readme/:repo", (req, res) => {
  options.url = `${HOST}repos/${OWNER}/${req.params.repo}/contents/README.md`;
  request(options, (error, response, body) => {
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

app.get("/last-commit/:repo", (req, res) => {
  options.url = `${HOST}repos/${OWNER}/${req.params.repo}/commits`;
  request(options, (error, response, body) => {
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

app.get("/languages/:repo", (req, res) => {
  getRepoLanguages(req.params.repo, res)
    .then((response) => {
      res.setHeader("Content-Type", "application/json");
      res.send(response);
    })
    .catch((error) => error);
});

app.get("/languages", (req, res) => {
  return getRepos(res)
    .then((repos) => {
      return Promise.all(
        JSON.parse(repos).map((repo) => getRepoLanguages(repo.name, res))
      )
        .then((languageSets) => {
          const languageObjects = languageSets.map((set) => JSON.parse(set));
          const languageData = sumObjectsByKeys(...languageObjects);
          const responseData = Object.entries(languageData).map(
            ([key, value]) => ({
              language: key,
              value,
            })
          );

          res.setHeader("Content-Type", "application/json");
          res.send(responseData);
        })
        .catch((error) => error);
    })
    .catch((error) => error);
});

app.use((req, res, next) => {
  let err = new Error("Not Found");
  err.status = 404;
  next(err);
});
app.use((err, req, res, next) => {
  res.sendStatus(err.status || 500);
});

app.listen(PORT);
console.log("Running on http://localhost:" + PORT);
