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

export class ArkCodeBuffer {
    output: string[] = [];
    indent: string = '';

    constructor(indent: string = '') {
        this.indent = indent;
    }

    public write(s: string): this {
        this.output.push(s);
        return this;
    }

    public writeLine(s: string): this {
        this.write(s);
        this.write('\n');
        return this;
    }

    public writeSpace(s: string): this {
        if (s.length === 0) {
            return this;
        }
        this.write(s);
        this.write(' ');
        return this;
    }

    public writeStringLiteral(s: string): this {
        this.write(`'${s}'`);
        return this;
    }

    public writeIndent(): this {
        this.write(this.indent);
        return this;
    }

    public incIndent(): this {
        this.indent += '  ';
        return this;
    }

    public decIndent(): this {
        if (this.indent.length >= 2) {
            this.indent = this.indent.substring(0, this.indent.length - 2);
        }
        return this;
    }

    public getIndent(): string {
        return this.indent;
    }

    public toString(): string {
        return this.output.join('');
    }

    public clear() {
        this.output = [];
    }
}

export class ArkStream extends ArkCodeBuffer {
    streamOut: fs.WriteStream;

    constructor(streamOut: fs.WriteStream) {
        super('');
        this.streamOut = streamOut;
    }

    public write(s: string): this {
        this.streamOut.write(s);
        return this;
    }

    public close(): void {
        this.streamOut.close();
    }
}
