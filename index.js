const nexline = require("nexline");
const fs = require("fs");
const countdown = require("countdown");
const { Client } = require("@elastic/elasticsearch");
const ora = require("ora");
const ProgressBar = require("progress");
const colors = require("colors");
const spinner_1 = ora("Getting the length of the file");
const shell = require("shelljs");
const program = require("commander");
const axios = require("axios");

let file, seperator, columns, lines, createNewIndex, index, connection;

checkMessage();

program
  .option("-c, --config <path>", "config file path")
  .option("-i, --inline <configString>", "base64 encoded config object");

program.on("--help", function() {
  console.log("");
  console.log("Examples:");
  console.log(`  $ ${program._name} -c ./config.json`);
  console.log(`  $ ${program._name} -i NDJjNGVx........GZzZGY=\n`);
  console.log(
    colors.blue(
      "For questions and error reports please visit the github repository: https://github.com/ofarukcaki/duckimport"
    )
  );
});

program.parse(process.argv);

if (!program.config && !program.inline) {
  console.log(
    colors.red('You must provide a config. Type "--help" for more details.')
  );
  process.exit(1);
} else if (program.config) {
  var _config = JSON.parse(fs.readFileSync(program.config));
  (file = _config.file),
    (seperator = _config.seperator),
    (columns = _config.columns),
    (lines = _config.lines),
    (createNewIndex = _config.createNewIndex),
    (index = _config.index),
    (connection = _config.client);
} else if (program.inline) {
  var _config = JSON.parse(Buffer.from(program.inline, "base64").toString());
  (file = _config.file),
    (seperator = _config.seperator),
    (columns = _config.columns),
    (lines = _config.lines),
    (createNewIndex = _config.createNewIndex),
    (index = _config.index),
    (connection = _config.client);
}

const client = new Client(connection);

let s = null;

console.table({
  file: file,
  seperator: seperator,
  columns: columns.join(),
  "target index": index.index
});

let bar = null;

const isSmall = smallerThan2GB(file);
if (isSmall) {
  const lc = getLength(file);

  bar = new ProgressBar(
    `Importing ${colors.cyan("[:bar]")} :percent    :rate/lps    ${
      "ETA:".bold
    } :etas`.yellow,
    {
      total: lc,
      width: 50
    }
  );
} else {
  console.log(
    colors.yellow(
      "File size exceeds 2GB, hence the tool won't calculate the length of the file. You won't see a progress bar but logs instead."
    )
  );
}

async function main() {
  const fd = fs.openSync(file, "r");

  const nl = nexline({
    input: fd // input can be file, stream, string and buffer
  });

  let dataset = [];

  let lc = 0;
  let total = 0;
  s = new Date(Date.now());
  console.log("> Started");
  while (true) {
    let line = await nl.next();
    if (line) line = line.trim(); //Remove the '\n' from the end of the line
    lc++;
    let obj = {};
    try {
      let splitted = line.split(seperator);
      for (let i = 0; i < columns.length; i++) {
        obj[columns[i]] = splitted[i];
      }
      dataset.push(obj); // push the object if != {}
    } catch (error) {}
    if (lc % lines === 0) {
      let err = await pushElastic(dataset);
      if (isSmall) {
        bar.tick(dataset.length);
      }
      if (err) {
        console.log("There is an error", err);
      } else if (!isSmall) {
        total += lines;
        console.log(`${lines} lines imported   Total: ${total}`);
      }
      dataset = [];
    }
    if (line === null) {
      // push remainders
      let err = await pushElastic(dataset);
      if (err) {
        console.log("There is an error");
      } else if (!isSmall) {
        total += lines;
        console.log(`${lines} lines imported   Total: ${total}`);
      }
      if (isSmall) {
        bar.tick(dataset.length);
      }
      dataset = [];
      // If all data is read, returns null
      console.log("> Completed");
      break;
    }
  }

  fs.closeSync(fd);
}

let isFirstTime = true;
async function pushElastic(dataset) {
  if (isFirstTime && createNewIndex) {
    // setup the index
    await client.indices.create(index, { ignore: [400] });
  }
  const _index = index.index;
  const body = dataset.flatMap(doc => [{ index: { _index } }, doc]);
  let errors = null;
  try {
    const { body: bulkResponse } = await client.bulk({ refresh: true, body });
    errors = bulkResponse.errors;
  } catch (error) {
    console.log("-"); // undefined error?
  }

  isFirstTime = false;
  return errors;
}

main();

function smallerThan2GB(file) {
  if (fs.statSync(file).size < 2147483649) {
    return true;
  } else {
    return false;
  }
}

function getLength(file) {
  spinner_1.start();
  const out = shell.exec(`wc -l ${file}`, { silent: true }).stdout.trim();
  const regex = /(\d*)\s.*/;
  const lc = parseInt(regex.exec(out)[1]);
  spinner_1.stopAndPersist({ symbol: ">", text: `${lc} lines detected.` });
  return lc;
}

function checkMessage() {
  axios({
    url:
      "https://raw.githubusercontent.com/ofarukcaki/duckimport/master/notification.md",
    timeout: "1000",
    method: "get"
  })
    .then(res => {
      if (res.status === 200) {
        console.log(colors.blue(res.data));
      }
    })
    .catch(err => {});
}

process.on("beforeExit", code => {
  console.log(
    colors.yellow(
      "\nTime took: ".bold +
        countdown(s, null, countdown.ALL, NaN, 0).toString()
    )
  );
});
