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

import { NodeID, BaseEdge, BaseGraph, BaseNode, Kind } from '../model/BaseGraph';
import { CallGraph, CallSite, DynCallSite } from '../model/CallGraph';
import { Value } from '../../core/base/Value';
import { ArkAssignStmt, ArkReturnStmt, Stmt } from '../../core/base/Stmt';
import { AbstractExpr, ArkNewArrayExpr, ArkNewExpr } from '../../core/base/Expr';
import { AbstractFieldRef, ArkArrayRef, ArkInstanceFieldRef, ArkParameterRef, ArkStaticFieldRef, ArkThisRef } from '../../core/base/Ref';
import { Local } from '../../core/base/Local';
import { GraphPrinter } from '../../save/GraphPrinter';
import { PrinterBuilder } from '../../save/PrinterBuilder';
import { Constant } from '../../core/base/Constant';
import { FunctionType } from '../../core/base/Type';
import { MethodSignature } from '../../core/model/ArkSignature';
import { ContextID } from './Context';
import Logger, { LOG_MODULE_TYPE } from '../../utils/logger';
import { GLOBAL_THIS } from '../../core/common/TSConst';
import { ExportInfo } from '../../core/model/ArkExport';

const logger = Logger.getLogger(LOG_MODULE_TYPE.ARKANALYZER, 'PTA');
export type PagNodeType = Value;

/*
 * Implementation of pointer-to assignment graph for pointer analysis
 */

const DUMMY_PAG_NODE_ID = -1

export enum PagEdgeKind {
    Address, Copy, Load, Write, This, Unknown, InterProceduralCopy
};

export enum StorageType {
    APP_STORAGE, LOCAL_STORAGE, Undefined
};

export enum StorageLinkEdgeType {
    Property2Local,
    Local2Property,
    TwoWay
}

export class PagEdge extends BaseEdge {
    private stmt: Stmt | undefined;

    constructor(n: PagNode, d: PagNode, k: PagEdgeKind, s?: Stmt) {
        super(n, d, k);
        this.stmt = s;
    };

    public getDotAttr(): string {
        switch (this.getKind()) {
            case PagEdgeKind.Address:
                return "color=green";
            case PagEdgeKind.Copy:
                if (this.stmt?.getInvokeExpr() !== undefined || this.stmt instanceof ArkReturnStmt) {
                    return "color=black,style=dotted";
                }
                return "color=black";
            case PagEdgeKind.Load:
                return "color=red";
            case PagEdgeKind.Write:
                return "color=blue"
            case PagEdgeKind.This:
                return "color=orange"
            case PagEdgeKind.InterProceduralCopy:
                return "color=purple,style=dashed";
            default:
                return "color=black";
        }
    }
}

export class AddrPagEdge extends PagEdge {
    constructor(n: PagNode, d: PagNode, s: Stmt) {
        super(n, d, PagEdgeKind.Address, s);
    };
}

export class CopyPagEdge extends PagEdge {
    constructor(n: PagNode, d: PagNode, s: Stmt) {
        super(n, d, PagEdgeKind.Copy, s);
    };
}

export class LoadPagEdge extends PagEdge {
    constructor(n: PagNode, d: PagNode, s: Stmt) {
        super(n, d, PagEdgeKind.Copy, s);
    };
}

export class WritePagEdge extends PagEdge {
    constructor(n: PagNode, d: PagNode, s: Stmt) {
        super(n, d, PagEdgeKind.Write, s);
    };
}

export class ThisPagEdge extends PagEdge {
    constructor(n: PagNode, d: PagNode, s: Stmt) {
        super(n, d, PagEdgeKind.This, s);
    };
}

type PagEdgeSet = Set<PagEdge>;

export enum PagNodeKind { HeapObj, LocalVar, RefVar, Param, ThisRef, Function, GlobalThis, ExportInfo }
export class PagNode extends BaseNode {
    private cid: ContextID | undefined;
    private value: Value;
    private stmt: Stmt | undefined; // stmt is just used for graph print
    private pointTo: Set<NodeID>;

    private addressInEdges!: PagEdgeSet;
    private addressOutEdges!: PagEdgeSet;
    private copyInEdges!: PagEdgeSet;
    private copyOutEdges!: PagEdgeSet;
    private loadInEdges!: PagEdgeSet;
    private loadOutEdges!: PagEdgeSet;
    private writeInEdges!: PagEdgeSet;
    private writeOutEdges!: PagEdgeSet;
    private thisInEdges!: PagEdgeSet;
    private thisOutEdges!: PagEdgeSet;

    // Point-to node of base class
    // Only PagInstanceRefNode has this field
    // Define in base class is for dot print
    protected basePt!: NodeID;
    protected clonedFrom!: NodeID;

    constructor(id: NodeID, cid: ContextID | undefined = undefined, value: Value, k: Kind, s?: Stmt) {
        super(id, k);
        this.cid = cid;
        this.value = value;
        this.stmt = s;
        this.pointTo = new Set<NodeID>;
    }

    public getBasePt(): NodeID {
        return this.basePt;
    }

    public setBasePt(pt: NodeID) {
        this.basePt = pt;
    }

    public getCid(): ContextID {
        if (this.cid === undefined) {
            throw new Error('cid is undefine')
        }
        return this.cid;
    }

    public setCid(cid: ContextID) {
        this.cid = cid;
    }

    public setStmt(s: Stmt) {
        this.stmt = s;
    }

    public getStmt(): Stmt | undefined {
        return this.stmt;
    }

    public hasOutgoingCopyEdge(): boolean {
        return (this.copyOutEdges.size !== 0);
    }

    public getOutgoingCopyEdges(): PagEdgeSet {
        return this.copyOutEdges;
    }

    public getIncomingCopyEdges(): PagEdgeSet {
        return this.copyInEdges;
    }

    public getOutgoingLoadEdges(): PagEdgeSet {
        return this.loadOutEdges;
    }

    public getOutgoingWriteEdges(): PagEdgeSet {
        return this.writeOutEdges;
    }

    public getIncomingWriteEdges(): PagEdgeSet {
        return this.writeInEdges;
    }

    public getOutgoingThisEdges(): PagEdgeSet {
        return this.thisOutEdges;
    }

    public getIncomingThisEdges(): PagEdgeSet {
        return this.thisInEdges;
    }

    public addAddressInEdge(e: AddrPagEdge): void {
        this.addressInEdges === undefined ? this.addressInEdges = new Set() : undefined;
        this.addressInEdges.add(e);
        this.addIncomingEdge(e);
    }

    public addAddressOutEdge(e: AddrPagEdge): void {
        this.addressOutEdges === undefined ? this.addressOutEdges = new Set() : undefined;
        this.addressOutEdges.add(e);
        this.addOutgoingEdge(e);
    }

    public addCopyInEdge(e: CopyPagEdge): void {
        this.copyInEdges === undefined ? this.copyInEdges = new Set() : undefined;
        this.copyInEdges.add(e);
        this.addIncomingEdge(e);
    }

    public addCopyOutEdge(e: CopyPagEdge): void {
        this.copyOutEdges === undefined ? this.copyOutEdges = new Set() : undefined;

        this.copyOutEdges.add(e);
        this.addOutgoingEdge(e);
    }

    public addLoadInEdge(e: LoadPagEdge): void {
        this.loadInEdges === undefined ? this.loadInEdges = new Set() : undefined;
        this.loadInEdges.add(e);
        this.addIncomingEdge(e);
    }

    public addLoadOutEdge(e: LoadPagEdge): void {
        this.loadOutEdges === undefined ? this.loadOutEdges = new Set() : undefined;
        this.loadOutEdges.add(e);
        this.addOutgoingEdge(e);
    }

    public addWriteInEdge(e: WritePagEdge): void {
        this.writeInEdges = this.writeInEdges ?? new Set();
        this.writeInEdges.add(e);
        this.addIncomingEdge(e);
    }

    public addWriteOutEdge(e: LoadPagEdge): void {
        this.writeOutEdges = this.writeOutEdges ?? new Set();
        this.writeOutEdges.add(e);
        this.addOutgoingEdge(e);
    }

    public addThisInEdge(e: ThisPagEdge): void {
        this.thisInEdges = this.thisInEdges ?? new Set();
        this.thisInEdges.add(e);
        this.addIncomingEdge(e);
    }

    public addThisOutEdge(e: ThisPagEdge): void {
        this.thisOutEdges = this.thisOutEdges ?? new Set();
        this.thisOutEdges.add(e);
        this.addOutgoingEdge(e);
    }

    public getValue(): Value {
        return this.value
    }

    public getPointTo(): Set<NodeID> {
        return this.pointTo
    }

    public addPointToElement(node: NodeID) {
        this.pointTo.add(node)
    }

    public setPointTo(pts: Set<NodeID>): void {
        this.pointTo = pts;
    }

    public getOutEdges() {
        return {
            AddressEdge: this.addressOutEdges,
            CopyEdge: this.copyOutEdges,
            LoadEdge: this.loadOutEdges,
            WriteEdge: this.writeOutEdges
        }
    }

    public getClonedFrom(): NodeID {
        return this.clonedFrom;
    }

    public setClonedFrom(id: NodeID): void {
        this.clonedFrom = id;
    }

    public getDotAttr(): string {
        switch (this.getKind()) {
            case PagNodeKind.HeapObj:
            case PagNodeKind.Function:
            case PagNodeKind.GlobalThis:
                return 'shape=box3d';
            case PagNodeKind.LocalVar:
                return 'shape=box';
            case PagNodeKind.RefVar:
                return 'shape=component';
            case PagNodeKind.Param:
                return 'shape=box';
            case PagNodeKind.ExportInfo:
                return 'shape=tab,color=purple';
            case PagNodeKind.ThisRef:
                return 'shape=box,color=orange'
            default:
                return 'shape=box';
        }
    }

    public getDotLabel(): string {
        let label: string;
        let param: ArkParameterRef;

        label = PagNodeKind[this.getKind()];
        label = label + ` ID: ${this.getID()} Ctx: ${this.cid}`;
        if (this.basePt) {
            label = label + ` base:{${this.basePt}}`;
        }
        label = label + ` pts:{${Array.from(this.pointTo).join(',')}}`

        if (this.getKind() === PagNodeKind.Param) {
            param = this.value as ArkParameterRef;
            label = label + `\nParam#${param.getIndex()} ${param.toString()}`;
        }

        if (this.getKind() === PagNodeKind.ThisRef) {
            label = label + `\n${(this.value as ArkThisRef).toString()}`;
        }

        if (this.stmt) {
            label = label + `\n${this.stmt.toString()}`;
            let method = this.stmt.getCfg()?.getDeclaringMethod().getSubSignature().toString();
            if (method) {
                label = label + '\n' + method;
            }
            label = label + ' ln: ' + this.stmt.getOriginPositionInfo().getLineNo();

        }

        return label;
    }
}

export class PagLocalNode extends PagNode {
    private relatedDynamicCallSite?: Set<DynCallSite>;
    private relatedUnknownCallSite?: Set<CallSite>;
    private storageLinked: boolean = false;
    private storageType?: StorageType;
    private propertyName?: string;

    private sdkParam: boolean = false;

    constructor(id: NodeID, cid: ContextID | undefined = undefined, value: Local, stmt?: Stmt) {
        super(id, cid, value, PagNodeKind.LocalVar, stmt)
    }

    public addRelatedDynCallSite(cs: DynCallSite) {
        this.relatedDynamicCallSite = this.relatedDynamicCallSite ?? new Set()

        this.relatedDynamicCallSite.add(cs)
    }

    public getRelatedDynCallSites(): Set<DynCallSite> {
        return this.relatedDynamicCallSite ?? new Set();
    }

    public addRelatedUnknownCallSite(cs: CallSite) {
        this.relatedUnknownCallSite = this.relatedUnknownCallSite ?? new Set();

        this.relatedUnknownCallSite.add(cs);
    }

    public getRelatedUnknownCallSites(): Set<CallSite> {
        return this.relatedUnknownCallSite ?? new Set();
    }

    public setStorageLink(storageType: StorageType, propertyName: string): void {
        this.storageLinked = true;
        this.storageType = storageType;
        this.propertyName = propertyName;
    }

    public getStorage(): {StorageType: StorageType, PropertyName: string} {
        return {
            StorageType: this.storageType!,
            PropertyName: this.propertyName!
        };
    }

    public isStorageLinked(): boolean {
        return this.storageLinked;
    }

    public setSdkParam(): void {
        this.sdkParam = true;
    }

    public isSdkParam(): boolean {
        return this.sdkParam;
    }
}

export class PagInstanceFieldNode extends PagNode {
    constructor(id: NodeID, cid: ContextID | undefined = undefined, instanceFieldRef: ArkInstanceFieldRef, stmt?: Stmt) {
        super(id, cid, instanceFieldRef, PagNodeKind.RefVar, stmt)
    }

}

export class PagStaticFieldNode extends PagNode {
    constructor(id: NodeID, cid: ContextID | undefined = undefined, staticFieldRef: ArkStaticFieldRef, stmt?: Stmt) {
        super(id, cid, staticFieldRef, PagNodeKind.RefVar, stmt)
    }
}

export class PagThisRefNode extends PagNode {
    pointToNode: NodeID[];
    constructor(id: NodeID, thisRef: ArkThisRef) {
        super(id, DUMMY_PAG_NODE_ID, thisRef, PagNodeKind.ThisRef);
        this.pointToNode = [];
    }

    public getThisPTNode(): NodeID[] {
        return this.pointToNode;
    }

    public addPTNode(ptNode: NodeID) {
        this.pointToNode.push(ptNode)
    }
}

export class PagArrayNode extends PagNode {
    base: Value;

    constructor(id: NodeID, cid: ContextID | undefined = undefined, expr: ArkArrayRef, stmt?: Stmt) {
        super(id, cid, expr, PagNodeKind.LocalVar, stmt);
        this.base = expr.getBase();
    }
}


/**
 * below is heapObj like Node
 */
export class PagNewExprNode extends PagNode {
    // store the cloned field node
    fieldNodes!: Map<string, NodeID>

    constructor(id: NodeID, cid: ContextID | undefined = undefined, expr: AbstractExpr, stmt?: Stmt) {
        super(id, cid, expr, PagNodeKind.HeapObj, stmt)
    }

    public addFieldNode(fieldSignature: AbstractFieldRef, nodeID: NodeID): boolean {
        if (!this.fieldNodes) {
            this.fieldNodes = new Map()
        }
        if (this.fieldNodes.has(fieldSignature.getFieldSignature().toString())) {
            return false
        }
        this.fieldNodes.set(fieldSignature.getFieldSignature().toString(), nodeID);
        return true
    }

    public getFieldNode(fieldSignature: AbstractFieldRef): NodeID | undefined {
        if (!this.fieldNodes) {
            return undefined
        }
        return this.fieldNodes.get(fieldSignature.getFieldSignature().toString())
    }

    public getFieldNodes(): Map<string, NodeID> | undefined {
        if (!this.fieldNodes) {
            return undefined
        }
        return this.fieldNodes
    }
}

export class PagNewArrayExprNode extends PagNode {
    // store the cloned array ref node
    elementNode: NodeID | undefined;

    constructor(id: NodeID, cid: ContextID | undefined = undefined, expr: ArkNewArrayExpr, stmt?: Stmt) {
        super(id, cid, expr, PagNodeKind.HeapObj, stmt);
    }

    public addElementNode(nodeID: NodeID): boolean {
        if (!this.elementNode) {
            this.elementNode = nodeID;
        }

        return true;
    }

    public getElementNode(): NodeID | undefined {
        return this.elementNode;
    }
}

export class PagParamNode extends PagNode {
    constructor(id: NodeID, cid: ContextID | undefined = undefined, r: ArkParameterRef, stmt?: Stmt) {
        super(id, cid, r, PagNodeKind.Param, stmt)
    }
}

export class PagFuncNode extends PagNode {
    private methodSignature!: MethodSignature
    // TODO: may add obj interface

    constructor(id: NodeID, cid: ContextID | undefined = undefined, r: Value, stmt?: Stmt, method?: MethodSignature) {
        super(id, cid, r, PagNodeKind.Function, stmt)
        if (method) {
            this.methodSignature = method;
        }
    }

    public setMethod(method: MethodSignature) {
        this.methodSignature = method
    }

    public getMethod(): MethodSignature {
        return this.methodSignature
    }
}

/**
 * almost same as PagNewExprNode, used only for globalThis and its field reference
 */
export class PagGlobalThisNode extends PagNode {
    fieldNodes: Map<string, NodeID>

    constructor(id: NodeID, cid: ContextID | undefined = undefined, r: Value, stmt?: Stmt) {
        super(id, cid, r, PagNodeKind.GlobalThis, stmt)
        this.fieldNodes = new Map()
    }

    public addFieldNode(fieldSignature: AbstractFieldRef, nodeID: NodeID): boolean {
        if (this.fieldNodes.has(fieldSignature.getFieldSignature().toString())) {
            return false
        }
        this.fieldNodes.set(fieldSignature.getFieldSignature().toString(), nodeID);
        return true
    }

    public getFieldNode(fieldSignature: AbstractFieldRef): NodeID | undefined {
        return this.fieldNodes.get(fieldSignature.getFieldSignature().toString())
    }

    public getFieldNodes(): Map<string, NodeID> | undefined {
        return this.fieldNodes
    }
}

export class Pag extends BaseGraph {

    private cg!: CallGraph;
    private contextValueToIdMap: Map<Value, Map<ContextID, NodeID>> = new Map();
    private ExportInfoToIdMap?: Map<ExportInfo, NodeID>;
    // contextBaseToIdMap will only be used in instance field
    // Value: instance field base value, NodeID: abstract nodes
    private contextBaseToIdMap: Map<Value, Map<ContextID, NodeID[]>> = new Map();
    // for reanalyze, will return new addr edges
    private stashAddrEdge: PagEdgeSet = new Set();
    private addrEdge: PagEdgeSet = new Set();
    private clonedNodeMap: Map<NodeID, Map<NodeID, NodeID>> = new Map();

    public getCG(): CallGraph {
        return this.cg;
    }

    /*
     * Clone a PagNode with same cid/value/stmt,
     * but different Node ID
     */
    public getOrClonePagNode(src: PagNode, basePt: NodeID): PagNode {
        if (src.getBasePt() !== undefined) {
            throw new Error('This is a cloned ref node, can not be cloned again');
        }

        let cloneSet = this.clonedNodeMap.get(src.getID());
        if (!cloneSet) {
            cloneSet = new Map<NodeID, NodeID>();
            this.clonedNodeMap.set(src.getID(), cloneSet);
        } else {
            let nodeID = cloneSet.get(basePt);
            if (nodeID) {
                return this.getNode(nodeID) as PagNode;
            }
        }

        // Not found
        let cloneNode = this.addPagNode(src.getCid(), src.getValue(), src.getStmt(), false)
        cloneNode.setClonedFrom(src.getID());
        cloneSet.set(basePt, cloneNode.getID());
        return cloneNode;
    }

    public getOrClonePagFieldNode(src: PagInstanceFieldNode, basePt: NodeID): PagInstanceFieldNode | undefined {
        let baseNode = this.getNode(basePt)
        if (baseNode instanceof PagNewExprNode || baseNode instanceof PagGlobalThisNode) {
            // check if real field node has been created with basePT, using FieldSignature as key
            let existedNode = baseNode.getFieldNode(src.getValue() as ArkInstanceFieldRef)
            if (existedNode) {
                return this.getNode(existedNode) as PagInstanceFieldNode
            }

            let fieldNode = this.getOrClonePagNode(src, basePt)
            baseNode.addFieldNode(src.getValue() as ArkInstanceFieldRef, fieldNode.getID())
            fieldNode.setBasePt(basePt)
            return fieldNode
        } else {
            logger.error(`Error clone field node ${src.getValue()}`)
            return undefined;
        }
    }

    public getOrClonePagArrayFieldNode(src: PagArrayNode, basePt: NodeID): PagInstanceFieldNode {
        let baseNode = this.getNode(basePt);
        if (baseNode instanceof PagNewArrayExprNode) {
            // check if Array Ref real node has been created or not, if not: create a real Array Ref node
            let existedNode = baseNode.getElementNode();
            if (existedNode) {
                return this.getNode(existedNode) as PagInstanceFieldNode;
            }

            let fieldNode = this.getOrClonePagNode(src, basePt);
            baseNode.addElementNode(fieldNode.getID());
            fieldNode.setBasePt(basePt);
            return fieldNode;
        } else {
            throw new Error(`Error clone array field node ${src.getValue()}`);
        }
    }

    public addPagNode(cid: ContextID, value: PagNodeType, stmt?: Stmt, refresh: boolean = true): PagNode {
        let id: NodeID = this.nodeNum;
        let pagNode: PagNode
        if (value instanceof Local) {
            const valueType = value.getType()
            if (valueType instanceof FunctionType &&
                (value.getDeclaringStmt() === null)) {
                // init function pointer
                pagNode = new PagFuncNode(id, cid, value, stmt, valueType.getMethodSignature())
            } else {
                // judge 'globalThis' is a redefined Local or real globalThis with its declaring stmt
                // value has been replaced in param
                if (value.getName() === GLOBAL_THIS && value.getDeclaringStmt() == null) {
                    pagNode = new PagGlobalThisNode(id, -1, value)
                } else {
                    pagNode = new PagLocalNode(id, cid, value, stmt);
                }
            }
        } else if (value instanceof ArkInstanceFieldRef) {
            if (value.getType() instanceof FunctionType) {
                // function ptr: let ptr = Class.MethodA
                pagNode = new PagFuncNode(id, cid, value, stmt,
                    (value.getType() as FunctionType).getMethodSignature());
            } else {
                // normal field
                pagNode = new PagInstanceFieldNode(id, cid, value, stmt);
            }
        } else if (value instanceof ArkStaticFieldRef) {
            if (value.getType() instanceof FunctionType) {
                // function ptr: let ptr = Class.StaticMethodA
                pagNode = new PagFuncNode(id, cid, value, stmt,
                    (value.getType() as FunctionType).getMethodSignature());
            } else {
                // normal field
                pagNode = new PagStaticFieldNode(id, cid, value, stmt);
            }
        } else if (value instanceof ArkArrayRef) {
            pagNode = new PagArrayNode(id, cid, value, stmt);
        } else if (value instanceof ArkNewExpr) {
            pagNode = new PagNewExprNode(id, cid, value, stmt);
        } else if (value instanceof ArkNewArrayExpr) {
            pagNode = new PagNewArrayExprNode(id, cid, value, stmt);
        } else if (value instanceof ArkParameterRef) {
            pagNode = new PagParamNode(id, cid, value, stmt);
        } else if (value instanceof ArkThisRef) {
            throw new Error('This Node need use addThisNode method');
        } else {
            throw new Error('unsupported Value type ' + value.getType().toString());
        }

        this.addNode(pagNode!);

        // Value
        if (!(value instanceof ExportInfo)) {
            this.addContextMap(refresh, cid, id, value, stmt!, pagNode!);
        } else {
            // ExportInfo
            this.addExportInfoMap(id, value);
        }

        return pagNode!;
    }
    
    private addExportInfoMap(id: NodeID, v: ExportInfo): void {
        this.ExportInfoToIdMap = this.ExportInfoToIdMap ?? new Map();
        this.ExportInfoToIdMap.set(v, id);
    }

    private addContextMap(refresh: boolean, cid: ContextID, id: NodeID, value: Value, stmt: Stmt, pagNode: PagNode): void {
        if (!refresh) {
            return;
        }

        let ctx2NdMap = this.contextValueToIdMap.get(value);
        if (!ctx2NdMap) {
            ctx2NdMap = new Map();
            this.contextValueToIdMap.set(value, ctx2NdMap);
        }
        ctx2NdMap.set(cid, id);

        if (value instanceof ArkInstanceFieldRef || value instanceof ArkArrayRef) {
            let base = value.getBase();
            //TODO: remove below once this Local is not uniq in %instInit is fix
            if (base instanceof Local && base.getName() === 'this') {
                stmt?.getCfg()?.getStmts().forEach(s => {
                    if (s instanceof ArkAssignStmt &&
                        (s.getLeftOp()) instanceof Local &&
                        (s.getLeftOp() as Local).getName() === 'this') {
                        base = s.getLeftOp() as Local;
                        return;
                    }
                });
            }
            let ctxMap = this.contextBaseToIdMap.get(base);
            if (ctxMap === undefined) {
                ctxMap = new Map();
                ctxMap.set(cid, [pagNode.getID()]);
            } else {
                let nodes = ctxMap.get(cid);
                if (nodes === undefined) {
                    nodes = [pagNode.getID()];
                } else {
                    nodes.push(pagNode.getID());
                }
                ctxMap.set(cid, nodes);
            }
            this.contextBaseToIdMap.set(base, ctxMap);
        }
    }

    /*
     * This node has no context info
     * but point to node info
     */
    public addPagThisRefNode(value: ArkThisRef): PagNode {
        let id: NodeID = this.nodeNum;
        let pagNode = new PagThisRefNode(id, value);
        this.addNode(pagNode);

        return pagNode;
    }

    public addPagThisLocalNode(ptNode: NodeID, value: Local): PagNode {
        let id: NodeID = this.nodeNum;
        let pagNode = new PagLocalNode(id, ptNode, value);
        this.addNode(pagNode);

        return pagNode;
    }

    public getOrNewThisRefNode(thisRefNodeID: NodeID, value: ArkThisRef): PagNode {
        if (thisRefNodeID !== -1) {
            return this.getNode(thisRefNodeID) as PagNode
        }

        let thisRefNode = this.addPagThisRefNode(value)
        return thisRefNode
    }

    public getOrNewThisLocalNode(cid: ContextID, ptNode: NodeID, value: Local, s?: Stmt): PagNode {
        if (ptNode !== -1) {
            return this.getNode(ptNode) as PagNode;
        } else {
            return this.getOrNewNode(cid, value, s);
        }
    }

    public hasExportNode(v: ExportInfo): NodeID | undefined {
        this.ExportInfoToIdMap = this.ExportInfoToIdMap ?? new Map();
        return this.ExportInfoToIdMap.get(v);
    }

    public hasCtxNode(cid: ContextID, v: Value): NodeID | undefined {
        let ctx2nd = this.contextValueToIdMap.get(v);
        if (!ctx2nd) {
            return undefined;
        }

        let ndId = ctx2nd.get(cid);
        if (!ndId) {
            return undefined;
        }

        return ndId;
    }

    public hasCtxRetNode(cid: ContextID, v: Value): NodeID | undefined {
        let ctx2nd = this.contextValueToIdMap.get(v);
        if (!ctx2nd) {
            return undefined;
        }

        let ndId = ctx2nd.get(cid);
        if (!ndId) {
            return undefined;
        }

        return ndId;
    }
    public getOrNewNode(cid: ContextID, v: PagNodeType, s?: Stmt): PagNode {
        let nodeId = undefined;
        // Value
        if (!(v instanceof ExportInfo)) {
            nodeId = this.hasCtxNode(cid, v);
        } else {
            // ExportInfo
            nodeId = this.hasExportNode(v);
        }

        if (nodeId !== undefined) {
            return this.getNode(nodeId) as PagNode;
        }

        return this.addPagNode(cid, v, s);
    }

    public getNodesByValue(v: Value): Map<ContextID, NodeID> | undefined {
        return this.contextValueToIdMap.get(v);
    }

    public getNodesByBaseValue(v: Value): Map<ContextID, NodeID[]> | undefined {
        return this.contextBaseToIdMap.get(v);
    }

    public addPagEdge(src: PagNode, dst: PagNode, kind: PagEdgeKind, stmt?: Stmt): boolean {
        // TODO: check if the edge already existing
        let edge = new PagEdge(src, dst, kind, stmt);
        if (this.ifEdgeExisting(edge)) {
            return false;
        }

        switch (kind) {
            case PagEdgeKind.Copy:
            case PagEdgeKind.InterProceduralCopy:
                src.addCopyOutEdge(edge);
                dst.addCopyInEdge(edge);
                if (src instanceof PagFuncNode ||
                    src instanceof PagGlobalThisNode ||
                    src instanceof PagNewExprNode ||
                    src instanceof PagNewArrayExprNode
                ) {
                    this.addrEdge.add(edge);
                    this.stashAddrEdge.add(edge);
                }
                break;
            case PagEdgeKind.Address:
                src.addAddressOutEdge(edge);
                dst.addAddressInEdge(edge);
                this.addrEdge.add(edge);
                this.stashAddrEdge.add(edge);
                break;
            case PagEdgeKind.Write:
                src.addWriteOutEdge(edge);
                dst.addWriteInEdge(edge);
                break;
            case PagEdgeKind.Load:
                src.addLoadOutEdge(edge);
                dst.addLoadInEdge(edge);
                break;
            case PagEdgeKind.This:
                src.addThisOutEdge(edge);
                dst.addThisInEdge(edge);
                break;
            default:
                ;
        }
        return true;
    }

    public getAddrEdges(): PagEdgeSet {
        return this.stashAddrEdge;
    }

    public resetAddrEdges() {
        this.stashAddrEdge.clear();
    }

    public getGraphName(): string {
        return 'PAG';
    }

    public dump(name: string): void {
        let printer = new GraphPrinter<this>(this);
        PrinterBuilder.dump(printer, name);
    }
}

export type InterProceduralSrcType = Local;
export type IntraProceduralEdge = { src: Value, dst: Value, kind: PagEdgeKind, stmt: Stmt }
export type InterProceduralEdge = { src: InterProceduralSrcType, dst: Value, kind: PagEdgeKind }

export class FuncPag {
    private internalEdges!: Set<IntraProceduralEdge>;
    private normalCallSites!: Set<CallSite>;
    private dynamicCallSites!: Set<DynCallSite>;
    private unknownCallSites!: Set<CallSite>;

    public getInternalEdges(): Set<IntraProceduralEdge> | undefined {
        return this.internalEdges;
    }

    public addNormalCallSite(cs: CallSite): void {
        this.normalCallSites = this.normalCallSites ?? new Set();
        this.normalCallSites.add(cs);
    }

    public getNormalCallSites(): Set<CallSite> {
        this.normalCallSites = this.normalCallSites ?? new Set();
        return this.normalCallSites;
    }

    public addDynamicCallSite(cs: DynCallSite): void {
        this.dynamicCallSites = this.dynamicCallSites ?? new Set();
        this.dynamicCallSites.add(cs);
    }

    public getDynamicCallSites(): Set<DynCallSite> {
        this.dynamicCallSites = this.dynamicCallSites ?? new Set();
        return this.dynamicCallSites;
    }

    public addUnknownCallSite(cs: CallSite): void {
        this.unknownCallSites = this.unknownCallSites ?? new Set();
        this.unknownCallSites.add(cs);
    }

    public getUnknownCallSites(): Set<CallSite> {
        this.unknownCallSites = this.unknownCallSites ?? new Set();
        return this.unknownCallSites;
    }

    public addInternalEdge(stmt: ArkAssignStmt, k: PagEdgeKind): boolean {
        this.internalEdges === undefined ? this.internalEdges = new Set() : undefined;
        let lhOp = stmt.getLeftOp();
        let rhOp = stmt.getRightOp();

        if (rhOp instanceof Constant) {
            return false;
        }

        let iEdge: IntraProceduralEdge = { src: rhOp, dst: lhOp, kind: k, stmt: stmt };
        this.internalEdges.add(iEdge);

        return true;
    }
}

export class InterFuncPag {
    private interFuncEdges: Set<InterProceduralEdge>;
    
    constructor() {
        this.interFuncEdges = new Set();
    }

    public getInterProceduralEdges(): Set<InterProceduralEdge> {
        return this.interFuncEdges;
    }

    public addToInterProceduralEdgeSet(e: InterProceduralEdge): void {
        this.interFuncEdges.add(e);
    }
}