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

import { COMPONENT_POP_FUNCTION } from '../core/common/EtsConst';
import { ViewTree, ViewTreeNode } from '../core/graph/ViewTree';
import { ClassSignature, MethodSignature } from '../core/model/ArkSignature';
import { Printer } from './Printer';

const DOT_FILE_HEADER = `digraph G {
    graph [nodesep=0.1]
    node [shape=box]
    edge [arrowhead=vee]
`;

export class ViewTreePrinter extends Printer {
    private viewTree: ViewTree;
    private dupCnt: number;

    constructor(viewTree: ViewTree) {
        super();
        this.viewTree = viewTree;
        this.dupCnt = 0;
    }

    public dump(): string {
        this.printer.clear();

        let root = this.viewTree.getRoot();
        if (!root) {
            return this.printer.toString();
        }

        this.printer.write(DOT_FILE_HEADER);
        this.walk(root, root.parent);
        this.printer.write('}');

        return this.printer.toString();
    }
    public dumpOriginal(): string {
        return '';
    }

    private walk(
        item: ViewTreeNode,
        parent: ViewTreeNode | null,
        map: Map<ViewTreeNode | ClassSignature | MethodSignature, string> = new Map()
    ): void {
        let skipChildren = this.writeNode(item, parent, map);
        if (skipChildren) {
            return;
        }
        for (const child of item.children) {
            this.walk(child, item, map);
        }
    }

    private escapeDotLabel(content: string[]): string {
        const MAX_LABEL_LEN = 64;
        const PRE_FIX_LEN = 5;
        let label = content.join('|');
        if (label.length > MAX_LABEL_LEN) {
            return (
                label.substring(0, PRE_FIX_LEN) + '...' + label.substring(label.length - MAX_LABEL_LEN + PRE_FIX_LEN)
            );
        }
        return label;
    }

    private writeNode(
        item: ViewTreeNode,
        parent: ViewTreeNode | null,
        map: Map<ViewTreeNode | ClassSignature | MethodSignature, string>
    ): boolean {
        let id = `Node${map.size}`;
        let hasSameNode = map.has(item) || map.has(item.signature!);

        if (hasSameNode) {
            id = `${id}_${this.dupCnt++}`;
            this.printer.write(`    ${id} [label="${item.name}" style=filled color="green"]\n`);
        } else {
            this.printer.write(`    ${id} [label="${item.name}"]\n`);
        }

        if (parent) {
            this.printer.write(`    ${map.get(parent)!} -> ${id}\n`);
        }

        this.writeNodeStateValues(item, id);
        this.writeNodeAttributes(item, id);
        this.writeNodeSignature(item, id);

        if (map.get(item)) {
            this.printer.write(`    {rank="same"; ${id};${map.get(item)};}\n`);
            this.printer.write(`    ${id} -> ${map.get(item)}[style=dotted]\n`);
            return true;
        } else if (map.get(item.signature!)) {
            this.printer.write(`    {rank="same"; ${id};${map.get(item.signature!)};}\n`);
            this.printer.write(`    ${id} -> ${map.get(item.signature!)}[style=dotted]\n`);
            return true;
        }

        map.set(item, id);
        if (item.signature && !map.has(item.signature)) {
            map.set(item.signature, id);
        }
        return false;
    }

    private writeNodeStateValues(item: ViewTreeNode, id: string): void {
        if (item.stateValues.size > 0) {
            let stateValuesId = `${id}val`;
            let content: string[] = [];
            item.stateValues.forEach((value) => {
                content.push(value.getName());
            });

            this.printer.write(
                `    ${stateValuesId} [shape=ellipse label="StateValues\n ${this.escapeDotLabel(
                    content
                )}" fontsize=10 height=.1 style=filled color=".7 .3 1.0" ]\n`
            );
            this.printer.write(`    ${id} -> ${stateValuesId}\n`);
        }
    }

    private writeNodeAttributes(item: ViewTreeNode, id: string): void {
        if (item.attributes.size > 0) {
            let attributesId = `${id}attributes`;
            let content: string[] = [];
            for (const [key, _] of item.attributes) {
                if (key !== COMPONENT_POP_FUNCTION) {
                    content.push(key);
                }
            }
            if (content.length > 0) {
                this.printer.write(
                    `    ${attributesId} [shape=ellipse label="property|Event\n${this.escapeDotLabel(
                        content
                    )}" fontsize=10 height=.1 style=filled color=".7 .3 1.0" ]\n`
                );
                this.printer.write(`    ${id} -> ${attributesId}\n`);
            }
        }
    }
    private writeNodeSignature(item: ViewTreeNode, id: string): void {
        if (item.signature) {
            let signatureId = `${id}signature`;
            let content = [item.signature.toString()];
            this.printer.write(
                `    ${signatureId} [shape=ellipse label="signature\n${this.escapeDotLabel(
                    content
                )}" fontsize=10 height=.1 style=filled color=".7 .3 1.0" ]\n`
            );
            this.printer.write(`    ${id} -> ${signatureId}\n`);
        }
    }
}
