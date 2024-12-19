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

import {SceneConfig} from '../src/Config';
import {Scene} from '../src/Scene';
import fs from 'fs';
import {CallGraphNode, FileSignature, MethodSignature, ViewTreeNode} from '../src';

// fs.unlinkSync("./PTG.dot");
if (fs.existsSync('./PTG.json')) {
    fs.unlinkSync('./PTG.json');
}

let config: SceneConfig = new SceneConfig();

// build from json
const jsonFile = './tests/AppTestConfig.json';
config.buildFromJson(jsonFile);
let projectName: string;
let targetProjectDirectory: string;

function readMainPagesFromJson(fileName: string): string[] {
    let configText = fs.readFileSync(fileName, 'utf-8');
    let configurations = JSON.parse(configText);
    projectName = configurations.targetProjectName;
    targetProjectDirectory = configurations.targetProjectDirectory;
    const mainPagesFile = `${targetProjectDirectory}/entry/src/main/resources/base/profile/main_pages.json`;
    // const mainPagesFile = `${targetProjectDirectory}/products/phone/src/main/resources/base/profile/main_pages.json`;
    configText = fs.readFileSync(mainPagesFile, 'utf-8');
    configurations = JSON.parse(configText);
    const mainPages = configurations.src;
    return mainPages;
}

const mainPages: string[] = readMainPagesFromJson(jsonFile);
console.log(mainPages);

const edges: string[][] = [];

function addEdge(pageName: string, component: string, targetPageName: string) {
    let exist = false;
    for (const [p, c, t] of edges) {
        if (p === pageName && c === component && t === targetPageName) {
            exist = true;
            break;
        }
    }
    if (!exist) {
        edges.push([pageName, component, targetPageName]);
    }
}

function runScene4Json(config: SceneConfig) {
    let projectScene: Scene = new Scene();
    projectScene.buildBasicInfo(config);
    projectScene.buildScene4HarmonyProject();
    projectScene.inferTypes();

    // let classes = projectScene.getClasses();
    for (const pageName of mainPages) {
        const signature = new FileSignature(projectName, `entry/src/main/ets/${pageName}.ets`);
        // const signature = new FileSignature(projectName, `products/phone/src/main/ets/${pageName}.ets`);
        const file = projectScene.getFile(signature);
        if (file) {
            const classes = file.getClasses();
            for (let clazz of classes) {
                if (clazz.hasEntryDecorator() && clazz.hasComponentDecorator()) {
                    let viewTree = clazz.getViewTree();
                    let root = viewTree?.getRoot();

                    const dfs = (node: ViewTreeNode | undefined, component: string, typeMap: Map<string, number>) => {
                        let hasCommon = false;
                        if (node?.attributes.has('onClick')) {
                            hasCommon = node?.isCustomComponent();
                            // console.log("%AM3$build");
                            // // @ts-ignore
                            // let methodSignature = node.attributes.get("onClick")[1];
                            // // @ts-ignore
                            // let callGraph = projectScene.makeCallGraphCHA(methodSignature);
                            // console.log(callGraph);
                            // @ts-ignore
                            // const methodText = node.attributes.get("onClick")[0].getOriginalText();

                            // if (methodText?.includes("router.pushUrl")) {
                            //     const urlPattern = /url:\s*['"]([^'"]+)['"]/;
                            //     const match = methodText.match(urlPattern);
                            //     if (match) {
                            //         const targetPageName = match[1];
                            //         console.log(targetPageName);
                            //         hasOnClick = true;
                            //     }
                            // }

                            // TODO:
                            // @ts-ignore
                            let methodSignature = node.attributes.get('onClick')[1];
                            const vis: Set<MethodSignature> = new Set();

                            const callGraphDFS = (methodSignature: MethodSignature) => {
                                let method = projectScene.getMethod(methodSignature);
                                if (!method) {
                                    return;
                                }
                                vis.add(methodSignature);
                                const code = method.getCode();
                                if (code?.includes('router.pushUrl') || code?.includes('router.replaceUrl')) {
                                    const urlPattern = /url:\s*['"]([^'"]+)['"]/g;
                                    const matches = [...code.matchAll(urlPattern)];
                                    for (const match of matches) {
                                        let targetPageName = match[1];
                                        if (targetPageName.startsWith('/')) {
                                            targetPageName = targetPageName.slice(1);
                                        }
                                        if (node?.isCustomComponent()) {
                                            // console.log([pageName, component + "/__Common__[1]", targetPageName]);
                                            // console.log(node.name);
                                            addEdge(pageName, component + '/__Common__[1]', targetPageName);
                                        } else {
                                            // console.log([pageName, component, targetPageName]);
                                            addEdge(pageName, component, targetPageName);
                                        }
                                    }
                                }
                                if (methodSignature instanceof MethodSignature) {
                                    // @ts-ignore
                                    let callGraph = projectScene.makeCallGraphCHA([methodSignature]);
                                    let methodNode = callGraph.getCallGraphNodeByMethod(method.getSignature());
                                    let outgoingEdges = methodNode.getOutgoingEdges();
                                    for (let edge of outgoingEdges) {
                                        let dstNode = edge.getDstNode() as CallGraphNode;
                                        let dstMethodSignature = dstNode.getMethod();
                                        let dstMethod = projectScene.getMethod(dstMethodSignature);
                                        if (dstMethod && dstMethod.getSignature() && !vis.has(dstMethod.getSignature())) {
                                            callGraphDFS(dstMethod.getSignature());
                                        }
                                    }
                                    // for (let i = 1; i < nodeNum; i++) {
                                    //     let edge = callGraph.getCallEdgeByPair(0, i);
                                    //     if (edge) {
                                    //         let dstNode = edge.getDstNode() as CallGraphNode;
                                    //         let dstMethodSignature = dstNode.getMethod();
                                    //         let dstMethod = projectScene.getMethod(dstMethodSignature);
                                    // if (!dstMethod) {
                                    //     continue;
                                    // }
                                    // const code = dstMethod.getCode();
                                    // if (code?.includes("router.pushUrl")) {
                                    //     const urlPattern = /url:\s*['"]([^'"]+)['"]/;
                                    //     const match = code.match(urlPattern);
                                    //     if (match) {
                                    //         const targetPageName = match[1];
                                    //         console.log(targetPageName);
                                    //         return;
                                    //     }
                                    // }
                                    // if (dstMethod && dstMethod.getSignature()) {
                                    //     callGraphDFS(dstMethod.getSignature());
                                    // }
                                    // }
                                    // }
                                }
                            };

                            if (methodSignature && methodSignature[0] instanceof MethodSignature) {
                                callGraphDFS(methodSignature[0]);
                            }

                        }
                        // hasCommon &&= hasOnClick;

                        // if (hasCommon) {
                        //     console.log([pageName, component + "/__Common__[1]", pageName]);
                        //     addEdge(pageName, component, pageName);
                        // }

                        // let typeMap = new Map<string, number>();
                        let children: ViewTreeNode[];
                        if (node === undefined) {
                            children = [root!];
                        } else {
                            children = node.children;
                        }
                        for (let child of children) {
                            if (hasCommon) {
                                dfs(child, component + '/__Common__[1]', new Map<string, number>());
                            } else {
                                if (child.name === 'View' || child.name === 'ForEach' || child.name === 'LazyForEach' || child.name === 'If' || child.name === 'IfBranch') {

                                    // If/Else If/Else structure => Shallow Clone
                                    if (child.name === 'IfBranch' && node && node.children.length > 1) {
                                        dfs(child, component, new Map<string, number>(typeMap));
                                    } else {
                                        dfs(child, component, typeMap);
                                    }

                                } else if (child.name === 'Builder' && (!node || node.name !== 'Tabs')) {
                                    dfs(child, component, typeMap);
                                } else {
                                    if (typeMap.has(child.name)) {
                                        // @ts-ignore
                                        typeMap.set(child.name, typeMap.get(child.name) + 1);
                                    } else {
                                        typeMap.set(child.name, 1);
                                    }
                                    let componentNum = typeMap.get(child.name);
                                    if (child.name === 'TabContent') {
                                        // dfs(child, component + "/Swiper[1]/" + child.name + "[" + componentNum + "]", new Map<string, number>());
                                        dfs(child, component + '/Swiper[1]/' + child.name + '[' + 1 + ']', new Map<string, number>());
                                    } else if (child.name === 'Builder') {
                                        if (node?.name === 'Tabs') {
                                            dfs(child, component + `/TabBar[1]/Column[${componentNum}]`, new Map<string, number>());
                                            addEdge(pageName, component + `/TabBar[1]/Column[${componentNum}]`, pageName);
                                        }
                                        // else {
                                        //     dfs(child, component, typeMap);
                                        // }
                                    } else {
                                        dfs(child, component + '/' + child.name + '[' + componentNum + ']', new Map<string, number>());
                                    }
                                }
                            }
                        }
                    };

                    // @ts-ignore
                    dfs(undefined, '//root[1]', new Map<string, number>());
                }
            }
        }
    }
}

runScene4Json(config);

function generateDotGraph(data: string[][]): string {
    let dotGraph = 'digraph G {\n';

    data.forEach(item => {
        const from = item[0];
        const content = item[1];
        // const content = item[1].substring(item[1].lastIndexOf("/") + 1);
        const to = item[2];

        // DOT 格式: "from" -> "to" [label="content"];
        dotGraph += `  "${from}" -> "${to}" [label="${content}, click"];\n`;
    });

    dotGraph += '}\n';
    return dotGraph;
}

const dotRepresentation = generateDotGraph(edges);
console.log(dotRepresentation);

// fs.writeFileSync("PTG.dot", dotRepresentation, "utf-8");

interface Edge {
    component: string;
    action: string;
    targetPage: string;
}

interface PageGraph {
    [page: string]: Edge[];
}

function writeGraph(data: string[][]) {
    const graph: PageGraph = {};
    data.forEach(item => {
        const from = item[0];
        const content = item[1];
        const to = item[2];

        if (!graph[from]) {
            graph[from] = [];
        }
        graph[from].push(
            {
                component: content,
                action: 'click',
                targetPage: to,
            },
        );
    });
    mainPages.forEach((page) => {
        if (!graph.hasOwnProperty(page)) {
            graph[page] = [];
        }
    });
    fs.writeFileSync('PTG.json', JSON.stringify(graph, null, 2), 'utf-8');
}

writeGraph(edges);
