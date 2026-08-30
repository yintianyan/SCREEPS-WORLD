/**
 * screeps-server-mockup 的 ambient 类型声明。
 *
 * 为什么不直接用包里的类型：依赖锁定在 github commit 703645f（Node 24 编译支持），
 * 但该 commit 的 package.json main 指向 src/、无 types 字段——其 `dist/*.d.ts` 只在
 * 本地旧安装残留或 prepare 构建后才存在。全量 typecheck（CI deploy 的
 * `npm ci --ignore-scripts` 不跑 prepare）因此拿到 TS2307/TS7016。
 * 本声明按该 commit 的真实 dist 声明镜像公开 API，使类型不依赖安装状态。
 * 包内 dist 类型若存在会被此声明遮蔽——升级依赖时需同步维护此文件。
 */
declare module "screeps-server-mockup" {
  import { EventEmitter } from "events";

  export type TerrainTypes = "plain" | "wall" | "swamp";

  export class TerrainMatrix {
    constructor();
    get(x: number, y: number): TerrainTypes;
    set(x: number, y: number, value: TerrainTypes): this;
    serialize(): string;
    static unserialize(str: string): TerrainMatrix;
  }

  export interface Notification {
    message: string;
    type: string;
    date: number;
    count: number;
    _id: string;
  }

  export interface AddBotOptions {
    username: string;
    room: string;
    x: number;
    y: number;
    gcl?: number;
    cpu?: number;
    cpuAvailable?: number;
    active?: number;
    spawnName?: string;
    modules?: {};
  }

  export class User extends EventEmitter {
    get id(): string;
    get username(): string;
    get cpu(): Promise<number>;
    get cpuAvailable(): Promise<number>;
    get gcl(): Promise<number>;
    get rooms(): Promise<any>;
    get lastUsedCpu(): Promise<number>;
    get memory(): Promise<string>;
    get notifications(): Promise<Notification[]>;
    get newNotifications(): Promise<Notification[]>;
    get activeSegments(): Promise<number[]>;
    getSegments(list: number[]): Promise<any[]>;
    console(cmd: string): Promise<any>;
    getData(name: string): Promise<any>;
    init(): Promise<this>;
  }

  export class World {
    constructor(server: ScreepsServer);
    get gameTime(): Promise<number>;
    load(): Promise<{ C: any; db: any; env: any; pubsub: any }>;
    setRoom(room: string, status?: string, active?: boolean): Promise<void>;
    addRoom(room: string): Promise<void>;
    getTerrain(room: string): Promise<TerrainMatrix>;
    setTerrain(room: string, terrain?: TerrainMatrix): Promise<void>;
    addRoomObject(
      room: string,
      type: string,
      x: number,
      y: number,
      attributes?: {},
    ): Promise<any>;
    reset(): Promise<void>;
    stubWorld(): Promise<void>;
    roomObjects(roomName: string): Promise<any[]>;
    addBot(opts: AddBotOptions): Promise<User>;
  }

  export interface ScreepsServerOptions {
    path: string;
    logdir: string;
    port: number;
    modfile?: string;
  }

  export class ScreepsServer extends EventEmitter {
    driver: any;
    config: any;
    common: any;
    constants: any;
    connected: boolean;
    world: World;
    constructor(opts?: Partial<ScreepsServerOptions>);
    setOpts(opts: ScreepsServerOptions): this;
    getOpts(): ScreepsServerOptions;
    connect(): Promise<this>;
    tick(): Promise<this>;
    start(): Promise<this>;
    stop(): this;
  }

  export const stdHooks: any;
}
