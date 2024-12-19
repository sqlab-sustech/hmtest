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

import { AbstractBinopExpr, AbstractInvokeExpr, ArkCastExpr, ArkUnopExpr } from '../base/Expr';
import { AbstractFieldRef, ArkArrayRef } from '../base/Ref';
import { Value } from '../base/Value';
import { Scene } from '../../Scene';
import ts from 'ohos-typescript';
import { SceneOptions } from '../../Config';
import { ArkMetadataKind } from '../model/ArkMetadata';
import { Stmt } from '../base/Stmt';
import { ArkBaseModel } from '../model/ArkBaseModel';

export class IRUtils {
    static moreThanOneAddress(value: Value): boolean {
        if (
            value instanceof AbstractBinopExpr ||
            value instanceof AbstractInvokeExpr ||
            value instanceof AbstractFieldRef ||
            value instanceof ArkArrayRef ||
            value instanceof ArkCastExpr ||
            value instanceof ArkUnopExpr
        ) {
            return true;
        }
        return false;
    }

    static generateTextForStmt(scene: Scene): void {
        for (const method of scene.getMethods()) {
            const cfg = method.getCfg();
            if (cfg) {
                for (const stmt of cfg.getStmts()) {
                    stmt.setText(stmt.toString());
                }
            }
        }
    }

    static setLeadingComments(
        metadata: Stmt | ArkBaseModel,
        node: ts.Node,
        sourceFile: ts.SourceFile,
        options: SceneOptions
    ): void {
        let comments = this.getLeadingComments(node, sourceFile, options);
        if (comments.length > 0) {
            metadata.setMetadata(ArkMetadataKind.LEADING_COMMENTS, comments);
        }
    }

    static getLeadingComments(node: ts.Node, sourceFile: ts.SourceFile, options: SceneOptions): string[] {
        let comments: string[] = [];
        if (!options.enableLeadingComments) {
            return comments;
        }
        const commentRanges = ts.getLeadingCommentRanges(node.getFullText(sourceFile), 0) || [];
        for (const range of commentRanges) {
            const comment = node.getFullText(sourceFile).slice(range.pos, range.end).replace(/\r\n/g, '\n');
            comments.push(comment);
        }
        return comments;
    }
}
