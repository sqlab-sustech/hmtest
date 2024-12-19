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

import { BasicBlock } from '../core/graph/BasicBlock';
import { ArkClass } from '../core/model/ArkClass';
import { ArkFile } from '../core/model/ArkFile';
import { ArkMethod } from '../core/model/ArkMethod';
import { ArkNamespace } from '../core/model/ArkNamespace';
import { Printer } from './Printer';
import { Cfg } from '../core/graph/Cfg';

/**
 * @category save
 */
export class DotMethodPrinter extends Printer {
    method: ArkMethod;
    nesting: boolean;

    constructor(method: ArkMethod, nesting: boolean = false) {
        super();
        this.method = method;
        this.nesting = nesting;
    }

    public dump(): string {
        this.printer.clear();
        if (this.nesting) {
            this.printer.writeIndent().writeLine(`subgraph "cluster_${this.method.getSignature()}" {`);
        } else {
            this.printer.writeIndent().writeLine(`digraph "${this.method.getSignature()}" {`);
        }
        this.printer.incIndent();
        this.printer.writeIndent().writeLine(`label="${this.method.getSignature()}";`);

        let blocks = (this.method.getCfg() as Cfg)?.getBlocks();
        let prefix = `Node${this.stringHashCode(this.method.getSignature().toString())}`;
        this.printBlocks(blocks, prefix);

        this.printer.decIndent();
        this.printer.writeIndent().writeLine('}');

        return this.printer.toString();
    }
    public dumpOriginal(): string {
        return '';
    }

    protected stringHashCode(name: string): number {
        let hashCode = 0;
        for (let i = 0; i < name.length; i++) {
            hashCode += name.charCodeAt(i);
        }
        return Math.abs(hashCode);
    }

    private printBlocks(blocks: Set<BasicBlock>, prefix: string): void {
        if (!blocks) {
            return;
        }
        let blockToNode: Map<BasicBlock, string> = new Map<BasicBlock, string>();
        let index = 0;
        for (let block of blocks) {
            let name = prefix + index++;
            blockToNode.set(block, name);
            /** Node0 [label="entry"]; */
            this.printer
                .writeIndent()
                .writeLine(`${name} [label="${this.getBlockContent(block, this.printer.getIndent())}"];`);
        }

        for (let block of blocks) {
            for (let nextBlock of block.getSuccessors()) {
                // Node0 -> Node1;
                this.printer.writeIndent().writeLine(`${blockToNode.get(block)} -> ${blockToNode.get(nextBlock)};`);
            }
        }
    }

    private getBlockContent(block: BasicBlock, indent: string): string {
        let content: string[] = [`id:${block.getId()}`];
        for (let stmt of block.getStmts()) {
            content.push(stmt.toString().replace(/"/g, '\\"'));
        }
        return content.join('\n    ' + indent);
    }
}

/**
 * @category save
 */
export class DotClassPrinter extends Printer {
    cls: ArkClass;
    nesting: boolean;

    constructor(cls: ArkClass, nesting: boolean = false) {
        super();
        this.cls = cls;
        this.nesting = nesting;
    }

    public dump(): string {
        this.printer.clear();
        if (!this.nesting) {
            this.printer.writeLine(`digraph "${this.cls.getName()}" {`);
            this.printer.incIndent();
        }

        for (let method of this.cls.getMethods()) {
            let mtd = new DotMethodPrinter(method, true);
            this.printer.write(mtd.dump());
        }

        if (!this.nesting) {
            this.printer.decIndent();
            this.printer.writeLine(`}`);
        }

        return this.printer.toString();
    }

    public dumpOriginal(): string {
        this.printer.clear();
        if (!this.nesting) {
            this.printer.writeLine(`digraph "${this.cls.getName()}" {`);
            this.printer.incIndent();
        }

        for (let method of this.cls.getMethods()) {
            let mtd = new DotMethodPrinter(method, true);
            this.printer.write(mtd.dumpOriginal());
        }

        if (!this.nesting) {
            this.printer.decIndent();
            this.printer.writeLine(`}`);
        }

        return this.printer.toString();
    }
}

/**
 * @category save
 */
export class DotNamespacePrinter extends Printer {
    ns: ArkNamespace;
    nesting: boolean;

    constructor(ns: ArkNamespace, nesting: boolean = false) {
        super();
        this.ns = ns;
        this.nesting = nesting;
    }

    public dump(): string {
        this.printer.clear();
        if (!this.nesting) {
            this.printer.writeLine(`digraph "${this.ns.getName()}" {`);
            this.printer.incIndent();
        }

        for (let method of this.ns.getAllMethodsUnderThisNamespace()) {
            let mtd = new DotMethodPrinter(method, true);
            this.printer.write(mtd.dump());
        }

        if (!this.nesting) {
            this.printer.decIndent();
            this.printer.writeLine(`}`);
        }

        return this.printer.toString();
    }

    public dumpOriginal(): string {
        this.printer.clear();
        if (!this.nesting) {
            this.printer.writeLine(`digraph "${this.ns.getName()}" {`);
            this.printer.incIndent();
        }

        for (let method of this.ns.getAllMethodsUnderThisNamespace()) {
            let mtd = new DotMethodPrinter(method, true);
            this.printer.write(mtd.dumpOriginal());
        }

        if (!this.nesting) {
            this.printer.decIndent();
            this.printer.writeLine(`}`);
        }
        return this.printer.toString();
    }
}

/**
 * @category save
 */
export class DotFilePrinter extends Printer {
    arkFile: ArkFile;

    constructor(arkFile: ArkFile) {
        super();
        this.arkFile = arkFile;
    }

    public dump(): string {
        this.printer.clear();
        this.printer.writeLine(`digraph "${this.arkFile.getName()}" {`);
        this.printer.incIndent();

        for (let ns of this.arkFile.getNamespaces()) {
            let nsPrinter = new DotNamespacePrinter(ns, true);
            this.printer.write(nsPrinter.dump());
        }

        // print class
        for (let cls of this.arkFile.getClasses()) {
            let clsPrinter = new DotClassPrinter(cls, true);
            this.printer.write(clsPrinter.dump());
        }

        this.printer.decIndent();
        this.printer.writeLine('}');

        return this.printer.toString();
    }
    public dumpOriginal(): string {
        this.printer.clear();
        this.printer.writeLine(`digraph "${this.arkFile.getName()}" {`);
        this.printer.incIndent();

        for (let ns of this.arkFile.getNamespaces()) {
            let nsPrinter = new DotNamespacePrinter(ns, true);
            this.printer.write(nsPrinter.dumpOriginal());
        }

        // print class
        for (let cls of this.arkFile.getClasses()) {
            let clsPrinter = new DotClassPrinter(cls, true);
            this.printer.write(clsPrinter.dumpOriginal());
        }

        this.printer.decIndent();
        this.printer.writeLine('}');

        return this.printer.toString();
    }
}
