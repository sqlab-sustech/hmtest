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

import { Stmt } from '../base/Stmt';

export class Edge {
    kind: number = 0;

    public static getKind(srcStmt: Stmt, tgtStmt: Stmt): number {
        return 0;
    }
}

export class PathEdgePoint<D> {
    public node:Stmt;
    public fact:D;

    constructor(node:Stmt, fact:D){
        this.node = node;
        this.fact = fact;
    }
}

export class PathEdge<D> {
    public edgeStart:PathEdgePoint<D>;
    public edgeEnd:PathEdgePoint<D>;

    constructor(start:PathEdgePoint<D>, end:PathEdgePoint<D>) {
        this.edgeStart=start;
        this.edgeEnd=end;
    }
}
