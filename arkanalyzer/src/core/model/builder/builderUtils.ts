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

import ts, { HeritageClause, ParameterDeclaration, TypeNode, TypeParameterDeclaration } from 'ohos-typescript';
import {
    ArrayType,
    ClassType,
    FunctionType,
    GenericType,
    TupleType,
    Type,
    UnclearReferenceType,
    UnionType,
    UnknownType,
} from '../../base/Type';
import { TypeInference } from '../../common/TypeInference';
import { ArkField } from '../ArkField';
import Logger, { LOG_MODULE_TYPE } from '../../../utils/logger';
import { ArkClass } from '../ArkClass';
import { ArkMethod } from '../ArkMethod';
import { Decorator } from '../../base/Decorator';
import {
    ArrayBindingPatternParameter,
    buildArkMethodFromArkClass,
    MethodParameter,
    ObjectBindingPatternParameter,
} from './ArkMethodBuilder';
import { buildNormalArkClassFromArkMethod } from './ArkClassBuilder';
import { Builtin } from '../../common/Builtin';
import { modifierKind2Enum } from '../ArkBaseModel';

const logger = Logger.getLogger(LOG_MODULE_TYPE.ARKANALYZER, 'builderUtils');

export function handleQualifiedName(node: ts.QualifiedName): string {
    let right = (node.right as ts.Identifier).text;
    let left: string = '';
    if (node.left.kind === ts.SyntaxKind.Identifier) {
        left = (node.left as ts.Identifier).text;
    } else if (node.left.kind === ts.SyntaxKind.QualifiedName) {
        left = handleQualifiedName(node.left as ts.QualifiedName);
    }
    let qualifiedName = left + '.' + right;
    return qualifiedName;
}

export function handlePropertyAccessExpression(node: ts.PropertyAccessExpression): string {
    let right = (node.name as ts.Identifier).text;
    let left: string = '';
    if (ts.SyntaxKind[node.expression.kind] === 'Identifier') {
        left = (node.expression as ts.Identifier).text;
    } else if (ts.isStringLiteral(node.expression)) {
        left = node.expression.text;
    } else if (ts.isPropertyAccessExpression(node.expression)) {
        left = handlePropertyAccessExpression(node.expression as ts.PropertyAccessExpression);
    }
    let propertyAccessExpressionName = left + '.' + right;
    return propertyAccessExpressionName;
}

export function buildDecorators(node: ts.Node, sourceFile: ts.SourceFile): Set<Decorator> {
    let decorators: Set<Decorator> = new Set();
    ts.getAllDecorators(node).forEach((decoratorNode) => {
        let decorator = parseDecorator(decoratorNode);
        if (decorator) {
            decorator.setContent(decoratorNode.expression.getText(sourceFile));
            decorators.add(decorator);
        }
    });
    return decorators;
}

function parseDecorator(node: ts.Decorator): Decorator | undefined {
    if (!node.expression) {
        return undefined;
    }

    let expression = node.expression;
    if (ts.isIdentifier(expression)) {
        return new Decorator(expression.text);
    }
    if (!ts.isCallExpression(expression) || !ts.isIdentifier(expression.expression)) {
        return undefined;
    }

    let decorator = new Decorator(expression.expression.text);

    if (expression.arguments.length > 0) {
        const arg = expression.arguments[0];
        if (ts.isArrowFunction(arg) && ts.isIdentifier(arg.body)) {
            decorator.setParam(arg.body.text);
        }
    }

    return decorator;
}

export function buildModifiers(node: ts.Node): number {
    let modifiers: number = 0;

    if (ts.canHaveModifiers(node)) {
        ts.getModifiers(node)?.forEach((modifier) => {
            modifiers |= modifierKind2Enum(modifier.kind);
        });
    }

    return modifiers;
}

export function buildHeritageClauses(heritageClauses: ts.NodeArray<HeritageClause>): Map<string, string> {
    let heritageClausesMap: Map<string, string> = new Map<string, string>();
    heritageClauses?.forEach((heritageClause) => {
        heritageClause.types.forEach((type) => {
            let heritageClauseName: string = '';
            if (type.typeArguments) {
                heritageClauseName = type.getText();
            } else if (ts.isIdentifier(type.expression)) {
                heritageClauseName = (type.expression as ts.Identifier).text;
            } else if (ts.isPropertyAccessExpression(type.expression)) {
                heritageClauseName = handlePropertyAccessExpression(type.expression);
            } else {
                heritageClauseName = type.getText();
            }
            heritageClausesMap.set(heritageClauseName, ts.SyntaxKind[heritageClause.token]);
        });
    });
    return heritageClausesMap;
}

export function buildTypeParameters(typeParameters: ts.NodeArray<TypeParameterDeclaration>,
                                    sourceFile: ts.SourceFile, arkInstance: ArkMethod | ArkClass): GenericType[] {
    const genericTypes: GenericType[] = [];
    let index = -1;
    typeParameters.forEach((typeParameter) => {
        const genericType = tsNode2Type(typeParameter, sourceFile, arkInstance);
        if (genericType instanceof GenericType) {
            genericType.setIndex(++index);
            genericTypes.push(genericType);
        }

        if (typeParameter.modifiers) {
            logger.warn('This typeparameter has modifiers.');
        }

        if (typeParameter.expression) {
            logger.warn('This typeparameter has expression.');
        }
    });
    return genericTypes;
}

export function buildParameters(params: ts.NodeArray<ParameterDeclaration>, arkInstance: ArkMethod | ArkField, sourceFile: ts.SourceFile) {
    let parameters: MethodParameter[] = [];
    params.forEach((parameter) => {
        let methodParameter = new MethodParameter();

        // name
        if (ts.isIdentifier(parameter.name)) {
            methodParameter.setName(parameter.name.text);
        } else if (ts.isObjectBindingPattern(parameter.name)) {
            methodParameter.setName('ObjectBindingPattern');
            let elements: ObjectBindingPatternParameter[] = [];
            parameter.name.elements.forEach((element) => {
                let paraElement = new ObjectBindingPatternParameter();
                if (element.propertyName) {
                    if (ts.isIdentifier(element.propertyName)) {
                        paraElement.setPropertyName(element.propertyName.text);
                    } else {
                        logger.warn('New propertyName of ObjectBindingPattern found, please contact developers to support this!');
                    }
                }

                if (element.name) {
                    if (ts.isIdentifier(element.name)) {
                        paraElement.setName(element.name.text);
                    } else {
                        logger.warn('New name of ObjectBindingPattern found, please contact developers to support this!');
                    }
                }

                if (element.initializer) {
                    logger.warn('TODO: support ObjectBindingPattern initializer.');
                }

                if (element.dotDotDotToken) {
                    paraElement.setOptional(true);
                }
                elements.push(paraElement);
            });
            methodParameter.setObjElements(elements);
        } else if (ts.isArrayBindingPattern(parameter.name)) {
            methodParameter.setName('ArrayBindingPattern');
            let elements: ArrayBindingPatternParameter[] = [];
            parameter.name.elements.forEach((element) => {
                let paraElement = new ArrayBindingPatternParameter();
                if (ts.isBindingElement(element)) {
                    if (element.propertyName) {
                        if (ts.isIdentifier(element.propertyName)) {
                            paraElement.setPropertyName(element.propertyName.text);
                        } else {
                            logger.warn('New propertyName of ArrayBindingPattern found, please contact developers to support this!');
                        }
                    }

                    if (element.name) {
                        if (ts.isIdentifier(element.name)) {
                            paraElement.setName(element.name.text);
                        } else {
                            logger.warn('New name of ArrayBindingPattern found, please contact developers to support this!');
                        }
                    }

                    if (element.initializer) {
                        logger.warn('TODO: support ArrayBindingPattern initializer.');
                    }

                    if (element.dotDotDotToken) {
                        paraElement.setOptional(true);
                    }
                } else if (ts.isOmittedExpression(element)) {
                    logger.warn('TODO: support OmittedExpression for ArrayBindingPattern parameter name.');
                }
                elements.push(paraElement);
            });
            methodParameter.setArrayElements(elements);
        } else {
            logger.warn('Parameter name is not identifier, ObjectBindingPattern nor ArrayBindingPattern, please contact developers to support this!');
        }

        // questionToken
        if (parameter.questionToken) {
            methodParameter.setOptional(true);
        }

        // type
        if (parameter.type) {
            methodParameter.setType(buildGenericType(tsNode2Type(parameter.type, sourceFile, arkInstance), arkInstance));
        } else {
            methodParameter.setType(UnknownType.getInstance());
        }

        // initializer
        if (parameter.initializer) {
            //TODO?
        }

        // dotDotDotToken
        if (parameter.dotDotDotToken) {
            methodParameter.setDotDotDotToken(true);
        }

        // modifiers
        if (parameter.modifiers) {
            //
        }

        parameters.push(methodParameter);
    });
    return parameters;
}

export function buildGenericType(type: Type, arkInstance: ArkMethod | ArkField): Type {
    function replace(urType: UnclearReferenceType): Type {
        const typeName = urType.getName();
        let gType;
        if (arkInstance instanceof ArkMethod) {
            gType = arkInstance.getGenericTypes()?.find(f => f.getName() === typeName);
        }
        if (!gType) {
            gType = arkInstance.getDeclaringArkClass().getGenericsTypes()?.find(f => f.getName() === typeName);
        }
        if (gType) {
            return gType;
        }
        const types = urType.getGenericTypes();
        for (let i = 0; i < types.length; i++) {
            const mayType = types[i];
            if (mayType instanceof UnclearReferenceType) {
                types[i] = replace(mayType);
            }
        }
        return urType;
    }

    if (type instanceof UnclearReferenceType) {
        return replace(type);
    } else if (type instanceof UnionType) {
        const types = type.getTypes();
        for (let i = 0; i < types.length; i++) {
            const mayType = types[i];
            if (mayType instanceof UnclearReferenceType) {
                types[i] = replace(mayType);
            }
        }
    }
    return type;
}

export function buildReturnType(node: TypeNode, sourceFile: ts.SourceFile, method: ArkMethod) {
    if (node) {
        return tsNode2Type(node, sourceFile, method);
    } else {
        return new UnknownType();
    }
}

export function tsNode2Type(typeNode: ts.TypeNode | ts.TypeParameterDeclaration, sourceFile: ts.SourceFile,
                            arkInstance: ArkMethod | ArkClass | ArkField): Type {
    if (ts.isTypeReferenceNode(typeNode)) {
        const genericTypes: Type[] = [];
        if (typeNode.typeArguments) {
            for (const typeArgument of typeNode.typeArguments) {
                genericTypes.push(tsNode2Type(typeArgument, sourceFile, arkInstance));
            }
        }
        let referenceNodeName = typeNode.typeName;
        if (ts.isQualifiedName(referenceNodeName)) {
            let parameterTypeStr = handleQualifiedName(referenceNodeName as ts.QualifiedName);
            return new UnclearReferenceType(parameterTypeStr, genericTypes);
        } else {
            let parameterTypeStr = referenceNodeName.text;
            return new UnclearReferenceType(parameterTypeStr, genericTypes);
        }
    } else if (ts.isUnionTypeNode(typeNode)) {
        let unionTypePara: Type[] = [];
        typeNode.types.forEach((tmpType) => {
            unionTypePara.push(tsNode2Type(tmpType, sourceFile, arkInstance));
        });
        return new UnionType(unionTypePara);
    } else if (ts.isLiteralTypeNode(typeNode)) {
        return buildTypeFromPreStr(ts.SyntaxKind[typeNode.literal.kind]);
    } else if (ts.isTypeLiteralNode(typeNode)) {
        let cls: ArkClass = new ArkClass();
        let declaringClass: ArkClass;

        if (arkInstance instanceof ArkMethod) {
            declaringClass = arkInstance.getDeclaringArkClass();
        } else if (arkInstance instanceof ArkField) {
            declaringClass = arkInstance.getDeclaringArkClass();
        } else {
            declaringClass = arkInstance;
        }
        if (declaringClass.getDeclaringArkNamespace()) {
            cls.setDeclaringArkNamespace(declaringClass.getDeclaringArkNamespace());
            cls.setDeclaringArkFile(declaringClass.getDeclaringArkFile());
        } else {
            cls.setDeclaringArkFile(declaringClass.getDeclaringArkFile());
        }
        buildNormalArkClassFromArkMethod(typeNode, cls, sourceFile);

        return new ClassType(cls.getSignature());
    } else if (ts.isFunctionTypeNode(typeNode)) {
        let mtd: ArkMethod = new ArkMethod();
        let cls: ArkClass;
        if (arkInstance instanceof ArkMethod) {
            cls = arkInstance.getDeclaringArkClass();
        } else if (arkInstance instanceof ArkClass) {
            cls = arkInstance;
        } else {
            cls = arkInstance.getDeclaringArkClass();
        }
        buildArkMethodFromArkClass(typeNode, cls, mtd, sourceFile);
        return new FunctionType(mtd.getSignature());
    } else if (ts.isTypeParameterDeclaration(typeNode)) {
        const name = typeNode.name.text;
        let defaultType;
        if (typeNode.default) {
            defaultType = tsNode2Type(typeNode.default, sourceFile, arkInstance);
        }
        let constraint;
        if (typeNode.constraint) {
            constraint = tsNode2Type(typeNode.constraint, sourceFile, arkInstance);
        }
        return new GenericType(name, defaultType, constraint);
    } else if (ts.isTupleTypeNode(typeNode)) {
        const types: Type[] = [];
        typeNode.elements.forEach(element => {
            types.push(tsNode2Type(element, sourceFile, arkInstance));
        });
        return new TupleType(types);
    } else if (ts.isArrayTypeNode(typeNode)) {
        return new ArrayType(tsNode2Type((typeNode as ts.ArrayTypeNode).elementType, sourceFile, arkInstance), 1);
    } else if (ts.isParenthesizedTypeNode(typeNode)) {
        return tsNode2Type(typeNode.type, sourceFile, arkInstance);
    } else if (typeNode.kind === ts.SyntaxKind.ObjectKeyword) {
        return new ClassType(Builtin.OBJECT_CLASS_SIGNATURE);
    } else {
        return buildTypeFromPreStr(ts.SyntaxKind[typeNode.kind]);
    }
}

export function buildTypeFromPreStr(preStr: string) {
    let postStr = '';
    switch (preStr) {
        case 'BooleanKeyword':
            postStr = 'boolean';
            break;
        case 'FalseKeyword':
            postStr = 'boolean';
            break;
        case 'TrueKeyword':
            postStr = 'boolean';
            break;
        case 'NumberKeyword':
            postStr = 'number';
            break;
        case 'NumericLiteral':
            postStr = 'number';
            break;
        case 'FirstLiteralToken':
            postStr = 'number';
            break;
        case 'StringKeyword':
            postStr = 'string';
            break;
        case 'StringLiteral':
            postStr = 'string';
            break;
        case 'UndefinedKeyword':
            postStr = 'undefined';
            break;
        case 'NullKeyword':
            postStr = 'null';
            break;
        case 'AnyKeyword':
            postStr = 'any';
            break;
        case 'VoidKeyword':
            postStr = 'void';
            break;
        case 'NeverKeyword':
            postStr = 'never';
            break;
        default:
            postStr = preStr;
    }
    return TypeInference.buildTypeFromStr(postStr);
}