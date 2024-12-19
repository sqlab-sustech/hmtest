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

import { Printer } from './Printer';
import { ArkFile } from '../core/model/ArkFile';
import { ArkMethod } from '../core/model/ArkMethod';
import { ArkNamespace } from '../core/model/ArkNamespace';
import { ArkClass } from '../core/model/ArkClass';
import { ArkField } from '../core/model/ArkField';
import {
    AnyType,
    ArrayType,
    BooleanType,
    ClassType,
    FunctionType,
    LiteralType,
    NeverType,
    NullType,
    NumberType,
    PrimitiveType,
    StringType,
    TupleType,
    Type,
    UnclearReferenceType,
    UndefinedType,
    UnionType,
    UnknownType,
    VoidType,
} from '../core/base/Type';
import { Value } from '../core/base/Value';
import {
    ArkAssignStmt,
    ArkIfStmt,
    ArkInvokeStmt,
    ArkReturnStmt,
    ArkReturnVoidStmt,
    ArkSwitchStmt,
    ArkThrowStmt,
    Stmt,
} from '../core/base/Stmt';
import {
    AbstractBinopExpr,
    ArkAwaitExpr,
    ArkCastExpr,
    ArkConditionExpr,
    ArkDeleteExpr,
    ArkInstanceInvokeExpr,
    ArkInstanceOfExpr,
    ArkNewArrayExpr,
    ArkNewExpr,
    ArkPhiExpr,
    ArkStaticInvokeExpr,
    ArkTypeOfExpr,
    ArkUnopExpr,
    ArkYieldExpr,
} from '../core/base/Expr';
import { Constant } from '../core/base/Constant';
import { MethodParameter } from '../core/model/builder/ArkMethodBuilder';
import { ImportInfo } from '../core/model/ArkImport';
import { ExportInfo } from '../core/model/ArkExport';
import { ClassSignature, FieldSignature, MethodSignature } from '../core/model/ArkSignature';
import { LineColPosition } from '../core/base/Position';
import { ArkArrayRef, ArkInstanceFieldRef, ArkParameterRef, ArkStaticFieldRef, ArkThisRef } from '../core/base/Ref';
import { Local } from '../core/base/Local';
import { Cfg } from '../core/graph/Cfg';
import { BasicBlock } from '../core/graph/BasicBlock';
import { ArkBody } from '../core/model/ArkBody';

export class JsonPrinter extends Printer {
    constructor(private arkFile: ArkFile) {
        super();
    }

    public dump(): string {
        const jsonObject = this.serializeArkFile(this.arkFile);
        return JSON.stringify(jsonObject, null, 2);
    }

    public dumpOriginal(): string {
        return "";
    }

    private serializeArkFile(arkFile: ArkFile): any {
        return {
            name: arkFile.getName(),
            namespaces: arkFile
                .getNamespaces()
                .map((ns) => this.serializeNamespace(ns)),
            classes: arkFile
                .getClasses()
                .map((cls) => this.serializeClass(cls)),
            importInfos: arkFile
                .getImportInfos()
                .map((info) => this.serializeImportInfo(info)),
            exportInfos: arkFile
                .getExportInfos().map((info) => this.serializeExportInfo(info)),
        };
    }

    private serializeNamespace(ns: ArkNamespace): any {
        return {
            name: ns.getName(),
            namespaces: ns.getNamespaces().map((ns) => this.serializeNamespace(ns)),
            classes: ns.getClasses().map((cls) => this.serializeClass(cls)),
        };
    }

    private serializeClass(cls: ArkClass): any {
        return {
            signature: this.serializeClassSignature(cls.getSignature()),
            modifiers: cls.getModifiers(),
            typeParameters: cls.getGenericsTypes()?.map((type) => this.serializeType(type)),
            superClassName: cls.getSuperClassName(),
            implementedInterfaceNames: cls.getImplementedInterfaceNames(),
            fields: cls.getFields().map((field) => this.serializeField(field)),
            methods: cls.getMethods(true).map((method) => this.serializeMethod(method)),
        };
    }

    private serializeField(field: ArkField): any {
        return {
            signature: this.serializeFieldSignature(field.getSignature()),
            modifiers: field.getModifiers(),
            questionToken: field.getQuestionToken(),
            exclamationToken: field.getExclamationToken(),
        };
    }

    private serializeMethod(method: ArkMethod): any {
        return {
            signature: this.serializeMethodSignature(method.getSignature()),
            modifiers: method.getModifiers(),
            typeParameters: method.getGenericTypes()?.map(type => this.serializeType(type)) || [],
            body: this.serializeMethodBody(method.getBody()),
        };
    }

    private serializeMethodBody(body: ArkBody | undefined) : any {
        if (body === undefined) {
            return null;
        }
        return {
            locals: Array.from(body.getLocals().values()).map(local => this.serializeLocal(local)),
            cfg: this.serializeCfg(body.getCfg()),
        };
    }

    private serializeMethodParameter(parameter: MethodParameter): any {
        return {
            name: parameter.getName(),
            type: this.serializeType(parameter.getType()),
            isOptional: parameter.isOptional(),
        };
    }

    private serializeImportInfo(importInfo: ImportInfo): any {
        return {
            importClauseName: importInfo.getImportClauseName(),
            importType: importInfo.getImportType(),
            importFrom: importInfo.getFrom(),
            nameBeforeAs: importInfo.getNameBeforeAs(),
            modifiers: importInfo.getModifiers(),
            originTsPosition: this.serializeLineColPosition(importInfo.getOriginTsPosition()),
        };
    }

    private serializeExportInfo(exportInfo: ExportInfo): any {
        return {
            exportClauseName: exportInfo.getExportClauseName(),
            exportClauseType: exportInfo.getExportClauseType(),
            exportFrom: exportInfo.getFrom(),
            nameBeforeAs: exportInfo.getNameBeforeAs(),
            isDefault: exportInfo.isDefault(),
            modifiers: exportInfo.getModifiers(),
            originTsPosition: this.serializeLineColPosition(exportInfo.getOriginTsPosition()),
        };
    }

    private serializeLineColPosition(position: LineColPosition): any {
        return {
            line: position.getLineNo(),
            col: position.getColNo(),
        };
    }

    private serializeType(type: Type): any {
        if (type === undefined) {
            return {
                "_": "UnknownType"
            };
        }

        if (type instanceof AnyType) {
            return {
                "_": "AnyType"
            };
        } else if (type instanceof UnknownType) {
            return {
                "_": "UnknownType"
            };
        } else if (type instanceof VoidType) {
            return {
                "_": "VoidType"
            };
        } else if (type instanceof NeverType) {
            return {
                "_": "NeverType"
            };
        } else if (type instanceof UnionType) {
            return {
                "_": "UnionType",
                "types": type.getTypes().map(t => this.serializeType(t)),
            };
        } else if (type instanceof TupleType) {
            return {
                "_": "TupleType",
                "types": type.getTypes().map(t => this.serializeType(t)),
            };
        } else if (type instanceof BooleanType) {
            return {
                "_": "BooleanType"
            };
        } else if (type instanceof NumberType) {
            return {
                "_": "NumberType"
            };
        } else if (type instanceof StringType) {
            return {
                "_": "StringType"
            };
        } else if (type instanceof NullType) {
            return {
                "_": "NullType"
            };
        } else if (type instanceof UndefinedType) {
            return {
                "_": "UndefinedType"
            };
        } else if (type instanceof LiteralType) {
            return {
                "_": "LiteralType",
                "literal": type.getLiteralName(),
            };
        } else if (type instanceof PrimitiveType) {
            throw new Error("Unhandled PrimitiveType: " + type.toString());
        } else if (type instanceof ClassType) {
            return {
                "_": "ClassType",
                "signature": this.serializeClassSignature(type.getClassSignature()),
            };
        } else if (type instanceof FunctionType) {
            return {
                "_": "FunctionType",
                "signature": this.serializeMethodSignature(type.getMethodSignature()),
            };
        } else if (type instanceof ArrayType) {
            return {
                "_": "ArrayType",
                "elementType": this.serializeType(type.getBaseType()),
                "dimensions": type.getDimension(),
            };
        } else if (type instanceof UnclearReferenceType) {
            return {
                "_": "UnclearReferenceType",
                "name": type.getName(),
            };
        } else {
            return {
                "_": "UNKNOWN_TYPE",
                "type": type.toString(),
            };
        }
    }

    private serializeClassSignature(clazz: ClassSignature): any {
        return {
            name: clazz.getClassName(),
        };
    }

    private serializeFieldSignature(field: FieldSignature): any {
        return {
            // TODO: handle NOT class signature
            enclosingClass: this.serializeClassSignature(field.getDeclaringSignature() as ClassSignature),
            name: field.getFieldName(),
            type: this.serializeType(field.getType()),
        };
    }

    private serializeMethodSignature(method: MethodSignature): any {
        return {
            enclosingClass: this.serializeClassSignature(method.getDeclaringClassSignature()),
            name: method.getMethodSubSignature().getMethodName(),
            parameters: method
                .getMethodSubSignature()
                .getParameters()
                .map(param => this.serializeMethodParameter(param)),
            returnType: this.serializeType(method.getType()),
        };
    }

    private serializeCfg(cfg: Cfg): any {
        // Traverse CFG basic blocks and fill their `id` fields in topological order:
        const visited = new Set<BasicBlock>();
        const stack: BasicBlock[] = [];
        const startingBlock = cfg.getStartingBlock();
        if (startingBlock) {
            stack.push(startingBlock);
        }
        let id = 0;
        while (stack.length > 0) {
            const block = stack.pop()!;
            if (visited.has(block)) {
                continue;
            }
            visited.add(block);
            block.setId(id++);
            stack.push(...block.getSuccessors());
        }
        return {
            blocks: Array.from(visited).map(block => this.serializeBasicBlock(block)),
        };
    }

    private serializeBasicBlock(block: BasicBlock): any {
        const successors = block.getSuccessors().map(successor => successor.getId());
        successors.sort((a, b) => a - b);
        return {
            id: block.getId(),
            successors,
            stmts: block.getStmts().map(stmt => this.serializeStmt(stmt)),
        };
    }

    private serializeLocal(local: Local): any {
        return {
            name: local.getName(),
            type: this.serializeType(local.getType()),
        };
    }

    private serializeValue(value: Value): any {
        if (value == null) {
            return null;
        }

        if (value === undefined) {
            throw new Error("Value is undefined");
        }

        if (value instanceof Local) {
            return {
                _: 'Local',
                ...this.serializeLocal(value),
            };
        } else if (value instanceof Constant) {
            return {
                _: 'Constant',
                value: value.getValue(),
                type: this.serializeType(value.getType()),
            };
        } else if (value instanceof ArkNewExpr) {
            return {
                _: 'NewExpr',
                classType: this.serializeType(value.getClassType()),
            };
        } else if (value instanceof ArkNewArrayExpr) {
            return {
                _: 'NewArrayExpr',
                elementType: this.serializeType(value.getBaseType()),
                size: this.serializeValue(value.getSize()),
            };
        } else if (value instanceof ArkDeleteExpr) {
            return {
                _: 'DeleteExpr',
                arg: this.serializeValue(value.getField()),
            }
        } else if (value instanceof ArkAwaitExpr) {
            return {
                _: "AwaitExpr",
                arg: this.serializeValue(value.getPromise()),
            }
        } else if (value instanceof ArkYieldExpr) {
            return {
                _: "YieldExpr",
                arg: this.serializeValue(value.getYieldValue()),
            }
        } else if (value instanceof ArkTypeOfExpr) {
            return {
                _: 'TypeOfExpr',
                arg: this.serializeValue(value.getOp()),
            };
        } else if (value instanceof ArkInstanceOfExpr) {
            return {
                _: 'InstanceOfExpr',
                arg: this.serializeValue(value.getOp()),
                checkType: this.serializeType(value.getCheckType()),
            };
        } else if (value instanceof ArkCastExpr) {
            return {
                _: 'CastExpr',
                arg: this.serializeValue(value.getOp()),
                type: this.serializeType(value.getType()),
            };
        } else if (value instanceof ArkPhiExpr) {
            const args = value.getArgs();
            const argToBlock = value.getArgToBlock();
            return {
                _: 'PhiExpr',
                args: args.map(arg => this.serializeValue(arg)),
                blocks: args.map(arg => argToBlock.get(arg)!.getId()),
                type: this.serializeType(value.getType()),
            };
        } else if (value instanceof ArkConditionExpr) {
            return {
                _: 'ConditionExpr',
                op: value.getOperator(),
                left: this.serializeValue(value.getOp1()),
                right: this.serializeValue(value.getOp2()),
                type: this.serializeType(value.getType()),
            };
        } else if (value instanceof AbstractBinopExpr) {
            return {
                _: 'BinopExpr',
                op: value.getOperator(),
                left: this.serializeValue(value.getOp1()),
                right: this.serializeValue(value.getOp2()),
            };
        } else if (value instanceof ArkUnopExpr) {
            return {
                _: 'UnopExpr',
                op: value.getOperator(),
                arg: this.serializeValue(value.getOp()),
            };
        } else if (value instanceof ArkInstanceInvokeExpr) {
            return {
                _: 'InstanceCallExpr',
                instance: this.serializeValue(value.getBase()),
                method: this.serializeMethodSignature(value.getMethodSignature()),
                args: value.getArgs().map(arg => this.serializeValue(arg)),
            };
        } else if (value instanceof ArkStaticInvokeExpr) {
            return {
                _: 'StaticCallExpr',
                method: this.serializeMethodSignature(value.getMethodSignature()),
                args: value.getArgs().map(arg => this.serializeValue(arg)),
            };
        } else if (value instanceof ArkThisRef) {
            return {
                _: 'ThisRef',
                type: this.serializeType(value.getType()),
            };
        } else if (value instanceof ArkParameterRef) {
            return {
                _: 'ParameterRef',
                index: value.getIndex(),
                type: this.serializeType(value.getType()),
            };
        } else if (value instanceof ArkArrayRef) {
            return {
                _: 'ArrayRef',
                array: this.serializeValue(value.getBase()),
                index: this.serializeValue(value.getIndex()),
                type: this.serializeType(value.getType()),
            };
        } else if (value instanceof ArkInstanceFieldRef) {
            return {
                _: 'InstanceFieldRef',
                instance: this.serializeValue(value.getBase()),
                field: this.serializeFieldSignature(value.getFieldSignature()),
            };
        } else if (value instanceof ArkStaticFieldRef) {
            return {
                _: 'StaticFieldRef',
                field: this.serializeFieldSignature(value.getFieldSignature()),
            };
        } else {
            return {
                _: 'UNKNOWN_VALUE',
                // TODO: add simple 'value' field here to be able to see the "unknown" value
                //       currently not possible due to circular structure
                //       which cannot be serialized via `JSON.stringify`
                // value,
                value: value.toString(),
            };
        }
    }

    private serializeStmt(stmt: Stmt): any {
        if (stmt instanceof ArkAssignStmt) {
            return {
                _: 'AssignStmt',
                left: this.serializeValue(stmt.getLeftOp()),
                right: this.serializeValue(stmt.getRightOp()),
            };
        } else if (stmt instanceof ArkInvokeStmt) {
            return {
                _: 'CallStmt',
                expr: this.serializeValue(stmt.getInvokeExpr()),
            };
        } else if (stmt instanceof ArkIfStmt) {
            return {
                _: 'IfStmt',
                condition: this.serializeValue(stmt.getConditionExprExpr()),
            };
        } else if (stmt instanceof ArkReturnVoidStmt) {
            return {
                _: 'ReturnVoidStmt',
            };
        } else if (stmt instanceof ArkReturnStmt) {
            return {
                _: 'ReturnStmt',
                arg: this.serializeValue(stmt.getOp())
            };
        } else if (stmt instanceof ArkThrowStmt) {
            return {
                _: 'ThrowStmt',
                arg: this.serializeValue(stmt.getOp()),
            };
        } else if (stmt instanceof ArkSwitchStmt) {
            return {
                _: 'SwitchStmt',
                arg: this.serializeValue(stmt.getKey()),
                cases: stmt.getCases().map((caseValue) => this.serializeValue(caseValue)),
            };
        } else {
            return {
                _: 'UNKNOWN_STMT',
                stmt: stmt.toString(),
            };
        }
    }
}
