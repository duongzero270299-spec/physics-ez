/* Physics EZ: nội dung do giáo viên thêm, không cần chạy lại mã.
   Có 3 nguồn nội dung, trang nào cũng tự gộp lại:
   1. noi-dung.json trên GitHub (cách cũ: tạo gói cập nhật rồi kéo vào kho GitHub)
   2. Supabase (cách mới: bấm nút Tải lên -> nhập mật khẩu tải lên một lần -> thêm / đăng / xóa bài,
      mọi người thấy ngay. Không cần tài khoản nào. Mật khẩu do Supabase kiểm tra,
      không nằm trong mã nguồn web)
   3. Lưu tạm trên máy này (IndexedDB) khi chưa đăng nhập
   Muốn bật Supabase: điền url và key trong file supabase-config.js. Để trống thì web chạy như cũ. */
(function(){
  var DB='physics-ez', ST='kv';
  function idb(){return new Promise(function(res,rej){
    if(!window.indexedDB){rej(new Error('no-idb'));return}
    var r;try{r=indexedDB.open(DB,1)}catch(e){rej(e);return}
    r.onupgradeneeded=function(){r.result.createObjectStore(ST)};
    r.onsuccess=function(){res(r.result)};r.onerror=function(){rej(r.error)};r.onblocked=function(){rej(new Error('blocked'))}})}
  function op(mode,fn){return idb().then(function(db){return new Promise(function(res,rej){
    var t=db.transaction(ST,mode),s=t.objectStore(ST),q=fn(s);
    t.oncomplete=function(){res(q&&'result' in q?q.result:undefined)};t.onerror=function(){rej(t.error)};t.onabort=function(){rej(t.error)}})})}
  function getItems(){return op('readonly',function(s){return s.get('items')}).then(function(v){return v||[]},function(){return []})}
  function putItems(a){return op('readwrite',function(s){return s.put(a,'items')})}
  function newId(p){return p+Date.now().toString(36)+Math.random().toString(36).slice(2,5)}
  function slug(t){return String(t||'bai').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/đ/g,'d').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,30)||'bai'}

  var EZ=window.EZ={};
  EZ.supported=function(){return idb().then(function(d){d.close();return true},function(){return false})};
  EZ.local=getItems;
  EZ.addSim=function(m,html,cover){
    var id=newId('s'), base='bai-them-'+slug(m.title)+'-'+id.slice(-4);
    var it={id:id,type:'sim',title:m.title,grade:m.grade,desc:m.desc||'',file:base+'.html',cover:cover?base+'.'+(cover.ext||'jpg'):''};
    return getItems().then(function(a){a.push(it);return putItems(a)}).then(function(){
      return op('readwrite',function(s){s.put(html,'f:'+it.file);if(cover)s.put(cover.blob,'f:'+it.cover);return s.get('items')})}).then(function(){return it});
  };
  EZ.addPrompt=function(m){
    var it={id:newId('p'),type:'prompt',group:m.group,title:m.title,text:m.text};
    return getItems().then(function(a){a.push(it);return putItems(a)}).then(function(){return it});
  };
  EZ.remove=function(id){
    return getItems().then(function(a){var it=a.filter(function(x){return x.id===id})[0];
      return putItems(a.filter(function(x){return x.id!==id})).then(function(){
        if(!it)return;return op('readwrite',function(s){if(it.file)s.delete('f:'+it.file);if(it.cover)s.delete('f:'+it.cover);return s.get('items')})})})};
  EZ.file=function(name){return op('readonly',function(s){return s.get('f:'+name)})};
  EZ.remote=function(){
    return fetch('noi-dung.json',{cache:'no-store'}).then(function(r){if(!r.ok)throw 0;return r.json()}).then(function(j){
      return (Array.isArray(j.items)?j.items:[]).filter(function(x){return x&&x.id&&x.type})},function(){return []})};

  /* ---------- Supabase (chỉ dùng fetch, không cần thư viện) ---------- */
  var CFG=window.EZ_SUPABASE||{}, KEY=String(CFG.key||'').trim();
  /* chỉ lấy phần https://xxxx.supabase.co (lỡ dán thừa /rest/v1/ hay đường dẫn khác vẫn chạy) */
  var SB=(String(CFG.url||'').trim().match(/^https?:\/\/[^\/\s?#]+/i)||[''])[0];
  var CLOUD=/^https?:\/\/[^\s\/]+$/.test(SB)&&KEY.length>20;
  EZ.cloudOn=CLOUD;
  EZ.cloudStatus=CLOUD?'chua':'tat'; /* tat | chua | ok | loi */
  function timeout(ms){var c=window.AbortController?new AbortController():null;return {signal:c?c.signal:undefined,t:c?setTimeout(function(){c.abort()},ms):0}}
  function rest(path){
    var to=timeout(10000);
    return fetch(SB+'/rest/v1/'+path,{headers:{apikey:KEY},cache:'no-store',signal:to.signal})
      .then(function(r){clearTimeout(to.t);if(!r.ok)throw new Error('http '+r.status);return r.json()},function(e){clearTimeout(to.t);throw e})}
  function rpc(fn,args,ms){
    var to=timeout(ms||60000);
    return fetch(SB+'/rest/v1/rpc/'+fn,{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify(args||{}),signal:to.signal})
      .then(function(r){clearTimeout(to.t);return r.text().then(function(t){var j=null;try{j=t?JSON.parse(t):null}catch(e){j=t}
        if(!r.ok){var m=(j&&(j.message||j.msg||j.error||j.hint))||('http '+r.status);if(r.status===413)m='413 Payload too large';throw new Error(m)}
        return j})},function(e){clearTimeout(to.t);throw e})}

  /* Đếm lượt truy cập: mỗi phiên trình duyệt chỉ cộng 1 lần, dù mở bao nhiêu trang */
  var visitP=null;
  /* EZ.visit(true): cần con số để hiện (trang chủ). EZ.visit(): chỉ đếm, đã đếm rồi thì không gọi Supabase nữa */
  EZ.visit=function(show){
    if(!CLOUD)return Promise.resolve(null);
    if(visitP)return visitP;
    var k='physics-ez.visited',done=false;
    try{done=sessionStorage.getItem(k)==='1'}catch(e){}
    if(done&&!show)return Promise.resolve(null);
    var job=done
      ?rest('site_stats?select=visits&id=eq.1').then(function(r){return r&&r[0]?Number(r[0].visits):null})
      :rpc('ghi_luot_truy_cap',{},10000).then(function(n){try{sessionStorage.setItem(k,'1')}catch(e){}return Number(n)});
    visitP=job.then(function(n){return isFinite(n)?n:null},function(){visitP=null;return null});
    return visitP};

  /* Đọc bài đã đăng (học sinh dùng). Ảnh bìa và file bài chỉ tải khi cần. */
  var COLS='id,loai,tieu_de,lop,mo_ta,nhom,noi_dung,tac_gia,tao_luc,co_anh';
  function fromRow(r){return {id:r.id,type:r.loai,title:r.tieu_de,grade:r.lop,desc:r.mo_ta||'',group:r.nhom||'',text:r.noi_dung||'',
    author:r.tac_gia||'',hasCover:!!r.co_anh,cover:r.co_anh?'cloud':'',cloud:true,pub:true}}
  var cloudCache=null;
  EZ.cloudList=function(fresh){
    if(!CLOUD)return Promise.resolve([]);
    if(cloudCache&&!fresh)return cloudCache;
    cloudCache=rest('bai_dang?select='+COLS+'&order=tao_luc.asc').then(function(rows){EZ.cloudStatus='ok';return (rows||[]).map(fromRow)},
      function(){EZ.cloudStatus='loi';cloudCache=null;return []});
    return cloudCache};
  var coverCache={};
  function cloudCover(id){
    if(!coverCache[id])coverCache[id]=rest('bai_dang?select=anh_bia&id=eq.'+encodeURIComponent(id)).then(function(r){return (r&&r[0]&&r[0].anh_bia)||''},function(){delete coverCache[id];return ''});
    return coverCache[id]}
  EZ.cloudSim=function(id){
    return rest('bai_dang?select=tieu_de,html&loai=eq.sim&id=eq.'+encodeURIComponent(id)).then(function(rows){
      var r=rows&&rows[0];return r?{title:r.tieu_de,html:r.html||''}:null})};
  /* Bài tải từ Supabase chạy trong khung tách riêng (không cùng nguồn với web).
     Một số bài AI viết có dùng localStorage: thay bằng bộ nhớ tạm để bài không bị lỗi. */
  var SHIM='<script>(function(){function M(){var d={};return{get length(){return Object.keys(d).length},key:function(i){return Object.keys(d)[i]||null},getItem:function(k){k=String(k);return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},setItem:function(k,v){d[String(k)]=String(v)},removeItem:function(k){delete d[String(k)]},clear:function(){d={}}}}["localStorage","sessionStorage"].forEach(function(n){try{window[n].getItem("_")}catch(e){try{Object.defineProperty(window,n,{value:M(),configurable:true})}catch(_){}}})})();<\/script>';
  EZ.withShim=function(h){h=String(h||'');
    var m=h.match(/<head[^>]*>/i)||h.match(/<html[^>]*>/i)||h.match(/<!doctype[^>]*>/i);
    if(!m)return SHIM+h;var i=h.indexOf(m[0])+m[0].length;return h.slice(0,i)+SHIM+h.slice(i)};

  /* all(): bản trên GitHub + bản trên Supabase + bản trên máy này chưa đăng */
  EZ.all=function(fresh){
    return Promise.all([EZ.remote(),EZ.cloudList(fresh),getItems()]).then(function(r){
      var seen={},pub=[];
      r[0].forEach(function(x){if(seen[x.id])return;seen[x.id]=1;x.pub=true;pub.push(x)});
      r[1].forEach(function(x){if(seen[x.id])return;seen[x.id]=1;pub.push(x)});
      var loc=r[2].filter(function(x){return !seen[x.id]}).map(function(x){x.pub=false;return x});
      return pub.concat(loc)})};
  EZ.manifest=function(items){return JSON.stringify({items:items.filter(function(x){return !x.cloud}).map(function(x){var c={};for(var k in x)if(k!=='pub')c[k]=x[k];return c})},null,2)};
  EZ.saveFile=async function(blob,name){
    try{var c=window.claude;if(c&&c.use){var d=await c.use('downloads');if(d){await d.save({filename:name,data:blob});return 'saved'}}}catch(e){if(e&&e.code==='declined')return 'declined'}
    var u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(u)},4000);return 'link'};
  EZ.esc=function(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})};
  EZ.coverUrl=function(it){
    if(it.cloud)return it.hasCover?cloudCover(it.id):Promise.resolve('');
    if(!it.cover)return Promise.resolve('');
    if(it.pub)return Promise.resolve(it.cover);
    return EZ.file(it.cover).then(function(b){return b?URL.createObjectURL(b):''},function(){return ''})};
  EZ.viewHref=function(it){return 'xem.html?'+(it.cloud?'c='+encodeURIComponent(it.id):it.pub?'f='+encodeURIComponent(it.file):'id='+encodeURIComponent(it.id))};

  /* ---------- Đăng nhập bằng MẬT KHẨU TẢI LÊN (không có tài khoản) ----------
     Mật khẩu do Supabase kiểm tra. Đúng thì giữ trong tab đang mở (đóng tab / Đăng xuất là phải nhập lại)
     và gửi kèm mỗi lần đăng bài. */
  var MK='physics-ez.mk',memMk='';
  function getMk(){try{return sessionStorage.getItem(MK)||memMk}catch(e){return memMk}}
  function setMk(v){memMk=v||'';try{if(v)sessionStorage.setItem(MK,v);else sessionStorage.removeItem(MK)}catch(e){}}
  EZ.canUpload=CLOUD;
  EZ.login=function(pw){
    if(!CLOUD)return Promise.reject(new Error('chua-noi-supabase'));
    pw=String(pw||'');
    return rpc('kiem_tra_mat_khau',{p_mat_khau:pw}).then(function(ok){if(ok!==true)throw new Error('sai-mat-khau');setMk(pw);return true})};
  EZ.loggedIn=function(){
    var m=getMk();if(!CLOUD||!m)return Promise.resolve(false);
    return rpc('kiem_tra_mat_khau',{p_mat_khau:m}).then(function(ok){if(ok!==true){setMk('');return false}return true})};
  EZ.logout=function(){setMk('');return Promise.resolve()};
  EZ.author=function(v){try{if(v!==undefined)localStorage.setItem('physics-ez.author',v);return localStorage.getItem('physics-ez.author')||''}catch(e){return v||''}};
  function need(){var m=getMk();return m?Promise.resolve(m):Promise.reject(new Error('chua-dang-nhap'))}
  function check(r){
    if(r&&r.ok===true){cloudCache=null;return r}
    if(r&&r.loi==='sai-mat-khau'){setMk('');throw new Error('mat-khau-da-doi')}
    throw new Error((r&&r.loi)||'loi-khong-ro')}
  /* Ảnh bìa: thu nhỏ còn tối đa 480 px, JPEG, lưu dạng data:image/... trong bảng */
  function coverData(blob){return new Promise(function(res){
    if(!blob){res(null);return}
    var im=new Image(),u=URL.createObjectURL(blob);
    im.onload=function(){var w=Math.min(480,im.width),h=Math.round(im.height*w/im.width),c=document.createElement('canvas');c.width=w;c.height=h;
      c.getContext('2d').drawImage(im,0,0,w,h);URL.revokeObjectURL(u);var d='';try{d=c.toDataURL('image/jpeg',.8)}catch(e){}res(/^data:image\//.test(d)?d:null)};
    im.onerror=function(){URL.revokeObjectURL(u);res(null)};im.src=u})}
  EZ.cloudAddSim=function(m,html,cover){
    return need().then(function(mk){return coverData(cover&&cover.blob).then(function(img){
      return rpc('dang_bai_mo_phong',{p_mat_khau:mk,p_tieu_de:m.title,p_lop:String(m.grade),p_mo_ta:m.desc||'',p_html:html,p_anh_bia:img,p_tac_gia:EZ.author()})})}).then(check)};
  EZ.cloudAddPrompt=function(m){
    return need().then(function(mk){return rpc('dang_cau_lenh',{p_mat_khau:mk,p_tieu_de:m.title,p_nhom:m.group,p_noi_dung:m.text,p_tac_gia:EZ.author()})}).then(check)};
  /* Xóa bài đã đăng (phải đang đăng nhập; máy chủ kiểm tra lại mật khẩu) */
  EZ.cloudRemove=function(it){
    return need().then(function(mk){return rpc('xoa_bai',{p_mat_khau:mk,p_id:it.id})}).then(check).then(function(r){delete coverCache[it.id];return r})};
  /* Đưa một bài đang nằm trên máy này lên Supabase, xong thì xóa bản trên máy */
  EZ.publishLocal=function(it){
    var job=it.type==='sim'
      ?Promise.all([EZ.file(it.file),it.cover?EZ.file(it.cover):null]).then(function(f){if(!f[0])throw new Error('mat-file');
          return EZ.cloudAddSim({title:it.title,grade:it.grade,desc:it.desc},f[0],f[1]?{blob:f[1]}:null)})
      :EZ.cloudAddPrompt({group:it.group,title:it.title,text:it.text});
    return job.then(function(n){return EZ.remove(it.id).then(function(){return n})})};

  EZ.visit();
})();
