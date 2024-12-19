/*
 * Copyright (c) 2024 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import path from 'path';
import fs from 'fs';
import { Command } from 'commander';
import { PrinterBuilder } from './PrinterBuilder';
import { SceneConfig } from '../Config';
import { Scene } from '../Scene';

function serializeTsFile(input: string, output: string, verbose: boolean = false) {
    if (verbose) console.log(`Serializing TS file to JSON: '${input}' -> '${output}'`);

    let filepath = path.resolve(input);
    let projectDir = path.dirname(filepath);

    if (verbose) console.log("Building scene...");
    let config = new SceneConfig();
    config.buildConfig("single-file", projectDir, []);
    config.getProjectFiles().push(filepath);
    let scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    let files = scene.getFiles();
    if (verbose) {
        console.log(`Scene contains ${files.length} files:`);
        for (let f of files) {
            console.log(`- '${f.getName()}'`);
        }
    }

    if (verbose) console.log("Extracting single ArkFile...");
    if (files.length === 0) {
        console.error(`ERROR: No files found in the project directory '${projectDir}'.`);
        process.exit(1);
    }
    if (files.length > 1) {
        console.error(`ERROR: More than one file found in the project directory '${projectDir}'.`);
        process.exit(1);
    }
    // Note: we explicitly push a single path to the project files (in config),
    //       so we expect there is only *one* ArkFile in the scene.
    let arkFile = scene.getFiles()[0];

    let outPath: string;
    if (fs.existsSync(output) && fs.statSync(output).isDirectory()) {
        outPath = path.join(output, arkFile.getName() + '.json');
    } else if (!fs.existsSync(output) && output.endsWith("/")) {
        outPath = path.join(output, arkFile.getName() + '.json');
    } else {
        outPath = output;
    }

    console.log(`Serializing ArkIR for '${arkFile.getName()}' to '${outPath}'...`);
    let printer = new PrinterBuilder();
    printer.dumpToJson(arkFile, outPath);

    if (verbose) console.log("All done!");
}

function serializeMultipleTsFiles(inputDir: string, outDir: string, verbose: boolean = false) {
    console.log(`Serializing multiple TS files to JSON: '${inputDir}' -> '${outDir}'`);

    if (fs.existsSync(outDir) && !fs.statSync(outDir).isDirectory()) {
        console.error(`ERROR: Output path must be a directory.`);
        process.exit(1);
    }

    if (verbose) console.log("Building scene...");
    let config = new SceneConfig();
    config.buildFromProjectDir(inputDir);
    let scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    let files = scene.getFiles();
    if (verbose) {
        console.log(`Scene contains ${files.length} files:`);
        for (let f of files) {
            console.log(`- '${f.getName()}'`);
        }
    }

    if (verbose) console.log("Serializing...");
    let printer = new PrinterBuilder();
    for (let f of files) {
        let filepath = f.getName();
        let outPath = path.join(outDir, filepath + '.json');
        console.log(`Serializing ArkIR for '${filepath}' to '${outPath}'...`);
        printer.dumpToJson(f, outPath);
    }

    if (verbose) console.log("All done!");
}

function serializeTsProject(inputDir: string, outDir: string, verbose: boolean = false) {
    console.log(`Serializing TS project to JSON: '${inputDir}' -> '${outDir}'`);

    if (fs.existsSync(outDir) && !fs.statSync(outDir).isDirectory()) {
        console.error(`ERROR: Output path must be a directory.`);
        process.exit(1);
    }

    if (verbose) console.log("Building scene...");
    let config = new SceneConfig();
    config.buildFromProjectDir(inputDir);
    let scene = new Scene();
    scene.buildSceneFromProjectDir(config);

    if (verbose) console.log("Serializing...");
    let printer = new PrinterBuilder();
    for (let f of scene.getFiles()) {
        let filepath = f.getName();
        let outPath = path.join(outDir, filepath + '.json');
        console.log(`Serializing ArkIR for '${filepath}' to '${outPath}'...`);
        printer.dumpToJson(f, outPath);
    }

    if (verbose) console.log("All done!");
}

export const program = new Command()
    .name('serializeArkIR')
    .description('Serialize ArkIR for TypeScript files or projects to JSON')
    .argument('<input>', 'Input file or directory')
    .argument('<output>', 'Output file or directory')
    .option('-m, --multi', 'Flag to indicate the input is a directory', false)
    .option('-p, --project', 'Flag to indicate the input is a project directory', false)
    .option('-v, --verbose', 'Verbose output', false)
    .action((input: any, output: any, options: any) => {

        // Check for invalid combinations of flags
        if (options.multi && options.project) {
            console.error(`ERROR: You cannot provide both the '-m' and '-p' flags.`);
            process.exit(1);
        }

        // Ensure the input path exists
        if (!fs.existsSync(input)) {
            console.error(`ERROR: The input path '${input}' does not exist.`);
            process.exit(1);
        }

        // Handle the case where the input is a directory
        if (fs.statSync(input).isDirectory() && !(options.multi || options.project)) {
            console.error(`ERROR: If the input is a directory, you must provide the '-p' or '-m' flag.`);
            process.exit(1);
        }

        if (options.project) {
            serializeTsProject(input, output, options.verbose);
        } else if (options.multi) {
            serializeMultipleTsFiles(input, output, options.verbose);
        } else {
            serializeTsFile(input, output, options.verbose);
        }
    });

if (require.main === module) {
    program.parse(process.argv);
}
