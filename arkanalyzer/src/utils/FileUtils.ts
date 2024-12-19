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

import fs from 'fs';
import path from 'path';
import Logger, { LOG_MODULE_TYPE } from './logger';
import { transfer2UnixPath } from './pathTransfer';

const logger = Logger.getLogger(LOG_MODULE_TYPE.ARKANALYZER, 'FileUtils');

export class FileUtils {
    public static readonly FILE_FILTER = {
        ignores: ['.git', '.preview', '.hvigor', '.idea', 'test', 'ohosTest'],
        include: /(?<!\.d)\.(ets|ts|json5)$/
    }

    public static getIndexFileName(srcPath: string): string {
        for (const fileInDir of fs.readdirSync(srcPath, { withFileTypes: true })) {
            if (fileInDir.isFile() && /^index(\.d)?\.e?ts$/i.test(fileInDir.name)) {
                return fileInDir.name;
            }
        }
        return '';
    }

    public static isDirectory(srcPath: string): boolean {
        try {
            return fs.statSync(srcPath).isDirectory();
        } catch (e) {

        }
        return false;
    }

    public static generateModuleMap(ohPkgContentMap: Map<string, { [k: string]: unknown }>) {
        const moduleMap: Map<string, ModulePath> = new Map();
        ohPkgContentMap.forEach((content, filePath) => {
            const moduleName = content.name as string;
            if (moduleName && moduleName.startsWith('@')) {
                const modulePath = path.dirname(filePath);
                moduleMap.set(moduleName, new ModulePath(modulePath, content.main ?
                    path.resolve(modulePath, content.main as string) : ''));
            }
        })
        ohPkgContentMap.forEach((content, filePath) => {
            if (content.dependencies) {
                Object.entries(content.dependencies).forEach(([name, value]) => {
                    if (!moduleMap.get(name)) {
                        const modulePath = path.resolve(path.dirname(filePath), value.replace('file:', ''));
                        const key = path.resolve(modulePath, 'oh-package.json5');
                        const target = ohPkgContentMap.get(key);
                        if (target) {
                            moduleMap.set(name, new ModulePath(modulePath, target.main ?
                                path.resolve(modulePath, target.main as string) : ''));
                        }
                    }
                })
            }
        })
        return moduleMap;
    }

}

export class ModulePath {
    path: string;
    main: string;

    constructor(path: string, main: string) {
        this.path = transfer2UnixPath(path);
        this.main = transfer2UnixPath(main);
    }
}

export function getFileRecursively(srcDir: string, fileName: string, visited: Set<string> = new Set<string>()): string {
    let res = '';
    if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) {
        logger.warn(`Input directory ${srcDir} is not exist`);
        return res;
    }

    const filesUnderThisDir = fs.readdirSync(srcDir, { withFileTypes: true });
    const realSrc = fs.realpathSync(srcDir)
    if (visited.has(realSrc)) {
        return res;
    }
    visited.add(realSrc);

    filesUnderThisDir.forEach(file => {
        if (res !== '') {
            return res;
        }
        if (file.name === fileName) {
            res = path.resolve(srcDir, file.name);
            return res;
        }
        const tmpDir = path.resolve(srcDir, '../');
        res = getFileRecursively(tmpDir, fileName, visited);
    });
    return res;
}