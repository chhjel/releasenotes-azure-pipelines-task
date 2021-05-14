import tl = require("azure-pipelines-task-lib/task");
import * as fs from 'fs';
import * as path from 'path';
import simpleGit, {DefaultLogFields, ListLogLine, LogResult, SimpleGit} from 'simple-git';
import * as xml2js from "xml2js";

async function run() {
  try {

    // Parameters
    let tagPattern: string = tl.getInput("tagPattern") || '';
    if (!tagPattern || tagPattern.length == 0) {
      tagPattern = '[0-9]*.[0-9]**';
    }
    let versionNumber: string | null = tl.getInput("versionNumber") || null;
    let jsonReleaseNotesPath: string | undefined = tl.getInput("jsonReleaseNotesPath");
    let nuspecPath: string | undefined = tl.getInput("nuspecPath");
    let buildMetadataJsonPath: string | undefined = tl.getInput("buildMetadataJsonPath");
    let createMissingFolders: boolean | undefined = tl.getBoolInput("createMissingFolders");

    // versionNumber = '1.2.3.4';
    // jsonReleaseNotesPath = 'ReleaseNotes.json';
    // nuspecPath = 'test.nuspec';
    // buildMetadataJsonPath = 'BuildMetadata.json';
    
    console.log(`----------------------------`);
    console.log(`--- Gathering data ---------`);
    console.log(`----------------------------`);
    const git: SimpleGit = simpleGit();
    const isRepo = await git.checkIsRepo();
    if (!isRepo)
    {
      tl.setResult(tl.TaskResult.Skipped, `'${process.cwd()}' is not within a git repository.`);
      return;
    }
    
    // Search for latest tag
    console.log(`Searching for latest tag matching pattern '${tagPattern}'..`);
    let tagName = '';
    let numberOfCommits = 0;
    let commitShortSha = '';
    try {
      const result = await git.raw([
        'describe',
        '--tags',
        '--candidates=1',
        '--match', tagPattern
      ]);

      const parts = result.trim().split('-');
      tagName = parts.slice(0, parts.length - 2).join('-');
      numberOfCommits = parseInt(parts[parts.length - 2]);
      commitShortSha = parts[parts.length - 1];
      
      console.log(`Found latest tag '${tagName}' ${numberOfCommits} commits ago (${commitShortSha}).`);
    }
    catch(e) {
      console.log(`No previous matching git version tags matching pattern '${tagPattern}' was found.`);
      
      const errorMessage: string = e.message;
      if (errorMessage && errorMessage.startsWith('fatal: No names found'))
      {
        // Ignored
      }
      else {
        console.info(e);
      }

      numberOfCommits = 1;
    }

    // Find commits back to the found tag
    let headCommit: (DefaultLogFields & ListLogLine) | null = null;
    let changes: ReadonlyArray<DefaultLogFields & ListLogLine> = [];

    // Found a version commit
    if (tagName && tagName.length > 0)
    {
      try {
        await git.log({
            from: 'HEAD',
            to: tagName
          },
          // @ts-ignore
          (err, log: LogResult) => {
            changes = log.all;
          });
  
        if (changes.length == 0)
        {
          tl.setResult(tl.TaskResult.Skipped, `Found zero commits since the detected tag.`);
          return;
        }
        
        console.log(`Found ${changes.length} commits:`);
        headCommit = changes[0];
        changes.forEach(x => console.log(` * ${truncateMessage(x.message, 20)}`));
      }
      catch(e) {
        tl.setResult(tl.TaskResult.Skipped, `Failed to find commits back to the detected tag. Error was: ${e}`);
        return;
      }
    }
    // Didn't find any version commit
    else
    {
      await git.log({
        from: 'HEAD',
        maxCount: 1
      },
      // @ts-ignore
      (err, log: LogResult) => {
        changes = log.all;
      });

      if (changes.length == 0)
      {
        tl.setResult(tl.TaskResult.Skipped, `Found zero commits.`);
        return;
      }
      
      console.log(`Using head commmit only:`);
      headCommit = changes[0];
      changes.forEach(x => console.log(` * ${truncateMessage(x.message, 20)}`));
    }
    console.log(`----------------------------`);
    console.log(``);

    // Create outputs
    if (jsonReleaseNotesPath)
    {
      console.log(`----------------------------`);
      console.log(`--- JSON Release notes -----`);
      console.log(`----------------------------`);
      if (createMissingFolders === true)
      {
        createMissingFolder(jsonReleaseNotesPath);
      }

      const parentDir = path.dirname(jsonReleaseNotesPath);
      if (!fs.existsSync(parentDir))
      {
        console.log(` Skipping output, parent folder '${parentDir}' does not exist.`);
      }
      else
      {
        const fileModel = {
          builtAt: new Date(),
          builtCommitHash: headCommit.hash,
          version: versionNumber,
          changes: changes.map(x => createChangeFromCommit(x))
        };
        const json = JSON.stringify(fileModel, null, 2);
        fs.writeFileSync(jsonReleaseNotesPath, json);
        console.log(`Created file '${jsonReleaseNotesPath}'.`);
      }
      console.log(`----------------------------`);
      console.log(``);
    }

    if (buildMetadataJsonPath)
    {
      console.log(`----------------------------`);
      console.log(`--- JSON Buildmetadata -----`);
      console.log(`----------------------------`);
      if (createMissingFolders === true)
      {
        createMissingFolder(buildMetadataJsonPath);
      }
      
      const parentDir = path.dirname(buildMetadataJsonPath);
      if (!fs.existsSync(parentDir))
      {
        console.log(` Skipping output, parent folder '${parentDir}' does not exist.`);
      }
      else
      {
        const obj = {
          builtAt: new Date(),
          builtCommitHash: headCommit.hash,
          version: versionNumber
        };
        const json = JSON.stringify(obj, null, 2);
        fs.writeFileSync(buildMetadataJsonPath, json);
        console.log(`Created file '${buildMetadataJsonPath}'.`);
      }
      console.log(`----------------------------`);
      console.log(``);
    }

    if (nuspecPath)
    {
      console.log(`----------------------------`);
      console.log(`--- Nuspec -----------------`);
      console.log(`----------------------------`);
      if (!fs.existsSync(nuspecPath))
      {
        console.warn(`Could not find nuspec to update at path '${nuspecPath}'.`);
      }
      else
      {
        let xml: string = fs.readFileSync(nuspecPath) as unknown as string;
        xml2js.parseString(xml, (err, result) => {
          const changesString = changes
            .map(x => createNuspecChangeNoteFromCommit(x))
            .join('\n');

          const metadata = result.package.metadata;
          metadata[0].releaseNotes = changesString;
          
          const builder = new xml2js.Builder();
          xml = builder.buildObject(result);
          
          fs.writeFileSync(nuspecPath as string, xml);
          console.log(`Updated nuspec '${nuspecPath}' with release notes.`);
        });
      }
      console.log(`----------------------------`);
      console.log(``);
    }

    console.log("All done!");
  } catch (err) {
    tl.setResult(tl.TaskResult.Failed, err.message);
  }
}

function truncateMessage(str: string, limit: number): string {
  str = str
    .trim()
    .replace('\n', '')
    .replace('\r', '');
  
  if (str.length > limit) {
    str = str.substring(0, limit) + "..";
  }
  return str;
}

function createNuspecChangeNoteFromCommit(commit: DefaultLogFields & ListLogLine): any
{
  return ` * ${commit.message}`;
}

function createChangeFromCommit(commit: DefaultLogFields & ListLogLine): any
{
  let issueIds = commit.message.match(/\w[\w\d_]+-\d+/gi) || [];
  const prMatch = commit.message.match(/\(#(\d+)\)$/i);
  let pullRequestNumber = !!prMatch ? prMatch[1] : null;

  let cleanMessage = commit.message
    .replace(` (#${pullRequestNumber})`, '');
  issueIds.forEach(x => cleanMessage = cleanMessage.replace(x, ''));
  cleanMessage = cleanMessage.trim();
  
  return {
    hash: commit.hash,
    timestamp: commit.date,
    authorName: commit.author_name,
    authorMail: commit.author_email,
    message: commit.message,
    body: commit.body,

    cleanMessage: cleanMessage,
    issueId: issueIds[0],
    issueIds: issueIds,
    pullRequestNumber: pullRequestNumber
  };
}

function createMissingFolder(filepath: string): void {
  let dir = path.dirname(filepath);
  if (!fs.existsSync(dir)) {
    console.log(`Creating missing folder '${dir}'.`);
    fs.mkdirSync(dir, { recursive: true });
  }
}

run();
