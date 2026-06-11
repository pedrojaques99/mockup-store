# PoC: render de mockup PSD pelo Photoshop real via COM (fidelidade total).
# A arte deve vir já no tamanho interno do smart object (o replaceContents herda o transform).
# Uso: powershell -File scripts/photoshop-render.ps1 -Psd <psd> -Art <png> -Out <png> [-SmartObject <nome>]
param(
  [Parameter(Mandatory)] [string]$Psd,
  [Parameter(Mandatory)] [string]$Art,
  [Parameter(Mandatory)] [string]$Out,
  [string]$SmartObject = ""
)

$PsdJs = (Resolve-Path $Psd).Path -replace '\\', '/'
$ArtJs = (Resolve-Path $Art).Path -replace '\\', '/'
$OutJs = $Out -replace '\\', '/'

$jsx = @"
(function(){
  var doc = app.open(new File("$PsdJs"));
  function walk(ls, fn){ for (var i = 0; i < ls.length; i++){ fn(ls[i]); if (ls[i].typename === 'LayerSet') walk(ls[i].layers, fn); } }
  function isSO(l){ try { return l.typename !== 'LayerSet' && l.kind == LayerKind.SMARTOBJECT; } catch(e){ return false; } }

  // Auto-hide de watermarks/instruções (mesmo BRAND_HIDE do render-server)
  walk(doc.layers, function(l){ if (/\[boxy\]|delete|remove\s*paper/i.test(l.name)) { try { l.visible = false; } catch(e){} } });

  // Prioridade de alvo: nome exato > parcial > padrões conhecidos
  var soName = "$SmartObject";
  var target = null;
  if (soName) {
    walk(doc.layers, function(l){ if (!target && isSO(l) && l.name === soName) target = l; });
    if (!target) walk(doc.layers, function(l){ if (!target && isSO(l) && l.name.toLowerCase().indexOf(soName.toLowerCase()) !== -1) target = l; });
  }
  if (!target) walk(doc.layers, function(l){ if (!target && isSO(l) && /edite|edit.*aqui|design.here|place.here|your.design|double.click|artwork/i.test(l.name)) target = l; });

  if (target) {
    doc.activeLayer = target;
    var d = new ActionDescriptor();
    d.putPath(charIDToTypeID('null'), new File("$ArtJs"));
    executeAction(stringIDToTypeID('placedLayerReplaceContents'), d, DialogModes.NO);
  }

  var dup = doc.duplicate();
  dup.flatten();
  dup.saveAs(new File("$OutJs"), new PNGSaveOptions(), true, Extension.LOWERCASE);
  dup.close(SaveOptions.DONOTSAVECHANGES);
  doc.close(SaveOptions.DONOTSAVECHANGES);
  return target ? "replaced: " + target.name : "ERRO: smart object nao encontrado";
})();
"@

$sw = [Diagnostics.Stopwatch]::StartNew()
$app = New-Object -ComObject Photoshop.Application
$app.DisplayDialogs = 3  # psDisplayNoDialogs
$launch = $sw.ElapsedMilliseconds
$result = $app.DoJavaScript($jsx)
$sw.Stop()

"resultado : $result"
"photoshop : $($launch)ms (launch/attach) + $($sw.ElapsedMilliseconds - $launch)ms (render) = $($sw.ElapsedMilliseconds)ms"
"saida     : $Out"
