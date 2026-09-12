/* FileSystemHandle-compatible adapter for the local PC service. */
(function () {
  "use strict";
  var versions = new Map();
  async function request(action, path, options) {
    var r = await fetch("/api/" + action + "?path=" + encodeURIComponent(path), Object.assign({cache:"no-store", headers:{"X-PKOS-Local":"1"}}, options));
    if (!r.ok) {
      var message = await r.json().catch(function () {return {};});
      var error = new DOMException(message.error || "PC 폴더 연결 실패", r.status === 404 ? "NotFoundError" : "InvalidStateError");
      error.status = r.status; throw error;
    }
    return r;
  }
  function child(path, name) {
    if (!name || /[\\/:]/.test(name) || name === "." || name === "..") throw new TypeError("잘못된 파일 이름");
    return path ? path + "/" + name : name;
  }
  class FileHandle {
    constructor(path) {this.path=path;this.name=path.split("/").pop();this.kind="file";}
    async getFile() {
      var r=await request("file",this.path), b=await r.blob();
      versions.set(this.path, r.headers.get("ETag"));
      return new File([b],this.name,{type:b.type,lastModified:Number(r.headers.get("X-PKOS-Mtime"))});
    }
    async createWritable() {
      var path=this.path, data=new Blob([]), closed=false;
      if(!versions.has(path)) {var stat=await(await request("stat",path)).json();versions.set(path,stat.version);}
      var expected=versions.get(path);
      if(!expected)throw new Error("PC 연결 프로그램을 새 버전으로 다시 실행해 주세요.");
      return {
        async write(value) {if(closed)throw new Error("이미 닫힌 파일");data=value;},
        async close() {if(closed)return;var result=await(await request("file",path,{method:"PUT",body:data,headers:{"X-PKOS-Local":"1","If-Match":expected}})).json();versions.set(path,result.version);closed=true;},
        async abort() {closed=true;data=null;}
      };
    }
  }
  class DirectoryHandle {
    constructor(path,name) {this.path=path;this.name=name||path.split("/").pop();this.kind="directory";}
    async queryPermission() {await request("stat",this.path);return "granted";}
    async requestPermission() {return this.queryPermission();}
    async getDirectoryHandle(name,options) {
      var path=child(this.path,name);
      if(options&&options.create)await request("directory",path,{method:"POST"});
      var row=await(await request("stat",path)).json();
      if(row.kind!=="directory")throw new DOMException("폴더가 아닙니다","TypeMismatchError");
      return new DirectoryHandle(path,name);
    }
    async getFileHandle(name,options) {
      var path=child(this.path,name);
      if(options&&options.create)await request("file",path,{method:"POST"});
      var row=await(await request("stat",path)).json();
      if(row.kind!=="file")throw new DOMException("파일이 아닙니다","TypeMismatchError");
      if(!versions.has(path))versions.set(path,row.version);
      return new FileHandle(path);
    }
    async *entries() {
      var rows=await(await request("list",this.path)).json();
      for(var row of rows)yield [row.name,row.kind==="directory"?new DirectoryHandle(child(this.path,row.name),row.name):new FileHandle(child(this.path,row.name))];
    }
    async *values() {for await(var pair of this.entries())yield pair[1];}
    async *keys() {for await(var pair of this.entries())yield pair[0];}
    [Symbol.asyncIterator]() {return this.entries();}
    async removeEntry(name,options) {
      if(options&&options.recursive)throw new Error("폴더 전체 삭제는 지원하지 않습니다");
      await request("entry",child(this.path,name),{method:"DELETE"});
    }
  }
  window.PKOSBridge={
    enabled:location.hostname==="127.0.0.1"&&new URLSearchParams(location.search).get("localBridge")==="1",
    async root() {var r=await request("status","");var status=await r.json();if(status.protocol!==2)throw new Error("PC 연결 프로그램을 새 버전으로 다시 실행해 주세요.");if(!status.ready)throw new Error(status.error||"폴더를 읽는 중입니다");return new DirectoryHandle("",status.name);}
  };
})();
