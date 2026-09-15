# firmar_gui.ps1
# GUI moderna (WPF) para firmar archivos con SignServer.


Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Windows.Forms   # solo para el diÃ¡logo clÃ¡sico de "Seleccionar archivo"

# ---------- CONFIGURACIÃ“N ----------
$SignServerHost = "172.18.117.229"
$Puerto = 8080

# CatÃ¡logo de workers: nombre real en SignServer, etiqueta bonita, descripciÃ³n, extensiones asociadas
$Workers = @(
    [pscustomobject]@{ Nombre="PDFSigner";           Etiqueta="PDF";                Desc="Firma documentos PDF";                                                          Ext=@(".pdf") }
    [pscustomobject]@{ Nombre="JArchiveSigner";       Etiqueta="Java (.jar)";        Desc="Firma archivos Java empaquetados";                                              Ext=@(".jar") }
    [pscustomobject]@{ Nombre="DebianDpkgSigSigner";  Etiqueta="Debian (.dsc)";      Desc="Firma metadatos de paquetes Debian/APT";                                        Ext=@(".dsc",".changes") }
    [pscustomobject]@{ Nombre="XMLSigner";            Etiqueta="XML";                Desc="Firma documentos XML (XMLDSig)";                                                Ext=@(".xml") }
    [pscustomobject]@{ Nombre="CMSSigner";            Etiqueta="Genérico (CMS)";     Desc="Firma cualquier archivo (CMS/PKCS#7)";                                          Ext=@() }
    [pscustomobject]@{ Nombre="TimeStampSigner";      Etiqueta="Sello de tiempo";    Desc="Requiere un TSQ (RFC 3161), no un archivo cualquiera. Uso avanzado.";          Ext=@(".tsq") }
    [pscustomobject]@{ Nombre="MRTDSigner";           Etiqueta="MRTD (chip)";        Desc="Firma datos crudos de chip de pasaporte (ICAO 9303). Uso muy especí­fico.";    Ext=@() }
    [pscustomobject]@{ Nombre="MRTDSODSigner";        Etiqueta="MRTD SOD";           Desc="Firma el documento SOD de pasaporte. Requiere estructura de datagroups.";     Ext=@() }
    [pscustomobject]@{ Nombre="CRLValidator";         Etiqueta="Validador (CRL)";    Desc="No firma: valida un certificado (.der/.cer) contra el emisor configurado.";   Ext=@(".der",".cer") }
)
# ------------------------------------

[xml]$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Firmar con SignServer" Height="560" Width="640"
        WindowStartupLocation="CenterScreen"
        Background="#1e1e2e" FontFamily="Segoe UI">
    <Window.Resources>
        <Style TargetType="Button">
            <Setter Property="Background" Value="#7c3aed"/>
            <Setter Property="Foreground" Value="White"/>
            <Setter Property="BorderThickness" Value="0"/>
            <Setter Property="Padding" Value="14,8"/>
            <Setter Property="FontWeight" Value="SemiBold"/>
            <Setter Property="Cursor" Value="Hand"/>
            <Setter Property="Template">
                <Setter.Value>
                    <ControlTemplate TargetType="Button">
                        <Border Background="{TemplateBinding Background}" CornerRadius="6" Padding="{TemplateBinding Padding}">
                            <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
                        </Border>
                    </ControlTemplate>
                </Setter.Value>
            </Setter>
        </Style>
        <Style x:Key="Secundario" TargetType="Button" BasedOn="{StaticResource {x:Type Button}}">
            <Setter Property="Background" Value="#313244"/>
        </Style>
        <Style TargetType="ComboBox">
            <Setter Property="Background" Value="#313244"/>
            <Setter Property="Foreground" Value="White"/>
            <Setter Property="Padding" Value="8"/>
            <Setter Property="BorderThickness" Value="0"/>
            <Setter Property="Template">
                <Setter.Value>
                    <ControlTemplate TargetType="ComboBox">
                        <Grid>
                            <ToggleButton Name="ToggleBtn" Focusable="False" IsChecked="{Binding IsDropDownOpen, RelativeSource={RelativeSource TemplatedParent}, Mode=TwoWay}"
                                          ClickMode="Press" Background="{TemplateBinding Background}">
                                <ToggleButton.Template>
                                    <ControlTemplate TargetType="ToggleButton">
                                        <Border Background="{TemplateBinding Background}" CornerRadius="6" Padding="{TemplateBinding Padding}">
                                            <Grid>
                                                <Grid.ColumnDefinitions>
                                                    <ColumnDefinition Width="*"/>
                                                    <ColumnDefinition Width="Auto"/>
                                                </Grid.ColumnDefinitions>
                                                <ContentPresenter Content="{TemplateBinding Content}" VerticalAlignment="Center"/>
                                                <TextBlock Grid.Column="1" Text="&#9662;" Foreground="#a6adc8" VerticalAlignment="Center" Margin="8,0,4,0"/>
                                            </Grid>
                                        </Border>
                                    </ControlTemplate>
                                </ToggleButton.Template>
                            </ToggleButton>
                            <ContentPresenter Name="ContentSite" IsHitTestVisible="False" Content="{TemplateBinding SelectionBoxItem}"
                                              Margin="12,8,30,8" VerticalAlignment="Center" HorizontalAlignment="Left"
                                              TextElement.Foreground="White"/>
                            <Popup Name="Popup" Placement="Bottom" IsOpen="{TemplateBinding IsDropDownOpen}" AllowsTransparency="True" Focusable="False" PopupAnimation="Slide">
                                <Border Background="#313244" CornerRadius="6" BorderBrush="#585b70" BorderThickness="1"
                                        MinWidth="{TemplateBinding ActualWidth}" Margin="0,2,0,0">
                                    <ScrollViewer Margin="2" SnapsToDevicePixels="True">
                                        <ItemsPresenter/>
                                    </ScrollViewer>
                                </Border>
                            </Popup>
                        </Grid>
                    </ControlTemplate>
                </Setter.Value>
            </Setter>
        </Style>
        <Style TargetType="ComboBoxItem">
            <Setter Property="Background" Value="#313244"/>
            <Setter Property="Foreground" Value="White"/>
            <Setter Property="Padding" Value="8,6"/>
            <Setter Property="Template">
                <Setter.Value>
                    <ControlTemplate TargetType="ComboBoxItem">
                        <Border Name="Bd" Background="{TemplateBinding Background}" Padding="{TemplateBinding Padding}">
                            <ContentPresenter/>
                        </Border>
                        <ControlTemplate.Triggers>
                            <Trigger Property="IsHighlighted" Value="True">
                                <Setter TargetName="Bd" Property="Background" Value="#7c3aed"/>
                            </Trigger>
                            <Trigger Property="IsSelected" Value="True">
                                <Setter TargetName="Bd" Property="Background" Value="#585b70"/>
                            </Trigger>
                        </ControlTemplate.Triggers>
                    </ControlTemplate>
                </Setter.Value>
            </Setter>
        </Style>
    </Window.Resources>

    <Grid Margin="24">
        <Grid.RowDefinitions>
            <RowDefinition Height="Auto"/>
            <RowDefinition Height="Auto"/>
            <RowDefinition Height="Auto"/>
            <RowDefinition Height="Auto"/>
            <RowDefinition Height="Auto"/>
            <RowDefinition Height="*"/>
            <RowDefinition Height="Auto"/>
        </Grid.RowDefinitions>

        <StackPanel Grid.Row="0" Margin="0,0,0,16">
            <TextBlock Text="Firmar con SignServer" FontSize="22" FontWeight="Bold" Foreground="White"/>
            <TextBlock Text="Arrastra un archivo o seleccionalo manualmente" FontSize="12" Foreground="#a6adc8" Margin="0,4,0,0"/>
        </StackPanel>

        <Border Grid.Row="1" Name="ZonaDrop" Background="#313244" CornerRadius="10" Padding="24" Margin="0,0,0,16"
                BorderBrush="#7c3aed" BorderThickness="2" AllowDrop="True">
            <Border.Style>
                <Style TargetType="Border">
                    <Style.Triggers>
                        <Trigger Property="AllowDrop" Value="True"/>
                    </Style.Triggers>
                </Style>
            </Border.Style>
            <StackPanel HorizontalAlignment="Center" VerticalAlignment="Center">
                <TextBlock Name="TxtDrop" Text="Suelta el archivo aquí­" FontSize="14" Foreground="#cdd6f4" HorizontalAlignment="Center"/>
                <TextBlock Name="TxtArchivo" Text="" FontSize="12" Foreground="#a6e3a1" Margin="0,8,0,0" HorizontalAlignment="Center" TextWrapping="Wrap"/>
                <Button Name="BtnSeleccionar" Content="Examinar archivo..." Margin="0,12,0,0" HorizontalAlignment="Center" Style="{StaticResource Secundario}"/>
            </StackPanel>
        </Border>

        <StackPanel Grid.Row="2" Orientation="Horizontal" Margin="0,0,0,16">
            <TextBlock Text="Worker:" Foreground="White" VerticalAlignment="Center" Width="70" FontWeight="SemiBold"/>
            <ComboBox Name="ComboWorker" Width="360"/>
        </StackPanel>

        <TextBlock Grid.Row="3" Name="TxtDescWorker" Text="" Foreground="#a6adc8" FontSize="12" Margin="0,0,0,16" TextWrapping="Wrap"/>

        <StackPanel Grid.Row="4" Orientation="Horizontal" Margin="0,0,0,16">
            <Button Name="BtnFirmar" Content="Firmar" Width="140" IsEnabled="False"/>
            <Button Name="BtnAbrirCarpeta" Content="Abrir resultado" Width="140" Margin="12,0,0,0" IsEnabled="False" Style="{StaticResource Secundario}"/>
            <ProgressBar Name="Progreso" Width="150" Height="8" Margin="20,0,0,0" IsIndeterminate="False" Visibility="Hidden"
                         Foreground="#7c3aed" Background="#313244" BorderThickness="0" VerticalAlignment="Center"/>
        </StackPanel>

        <Border Grid.Row="5" Background="#11111b" CornerRadius="8" Padding="12">
            <ScrollViewer VerticalScrollBarVisibility="Auto">
                <TextBlock Name="TxtLog" Foreground="#a6adc8" FontFamily="Consolas" FontSize="12" TextWrapping="Wrap"/>
            </ScrollViewer>
        </Border>

        <TextBlock Grid.Row="6" Name="TxtEstado" Text="Listo." Foreground="#a6adc8" FontSize="11" Margin="0,10,0,0"/>
    </Grid>
</Window>
"@

$reader = New-Object System.Xml.XmlNodeReader $xaml
$window = [Windows.Markup.XamlReader]::Load($reader)

$ZonaDrop        = $window.FindName("ZonaDrop")
$TxtDrop         = $window.FindName("TxtDrop")
$TxtArchivo      = $window.FindName("TxtArchivo")
$BtnSeleccionar  = $window.FindName("BtnSeleccionar")
$ComboWorker     = $window.FindName("ComboWorker")
$TxtDescWorker   = $window.FindName("TxtDescWorker")
$BtnFirmar       = $window.FindName("BtnFirmar")
$BtnAbrirCarpeta = $window.FindName("BtnAbrirCarpeta")
$Progreso        = $window.FindName("Progreso")
$TxtLog          = $window.FindName("TxtLog")
$TxtEstado       = $window.FindName("TxtEstado")

foreach ($w in $Workers) { [void]$ComboWorker.Items.Add($w.Etiqueta) }
$ComboWorker.SelectedIndex = 0

$script:rutaSeleccionada = $null
$script:rutaResultado = $null

function Agregar-Log($texto) {
    $TxtLog.Text += "$texto`n"
}

function Detectar-WorkerPorExtension($ruta) {
    $ext = [System.IO.Path]::GetExtension($ruta).ToLower()
    foreach ($w in $Workers) {
        if ($w.Ext -contains $ext) { return $w }
    }
    return $Workers | Where-Object { $_.Nombre -eq "CMSSigner" }
}

function Actualizar-Archivo($ruta) {
    $script:rutaSeleccionada = $ruta
    $TxtArchivo.Text = [System.IO.Path]::GetFileName($ruta)
    $TxtDrop.Text = "Archivo listo:"
    $BtnFirmar.IsEnabled = $true

    $wDetectado = Detectar-WorkerPorExtension $ruta
    $idx = [array]::IndexOf(($Workers.Etiqueta), $wDetectado.Etiqueta)
    if ($idx -ge 0) { $ComboWorker.SelectedIndex = $idx }
}

$ComboWorker.Add_SelectionChanged({
    $w = $Workers[$ComboWorker.SelectedIndex]
    $TxtDescWorker.Text = $w.Desc
})
$TxtDescWorker.Text = $Workers[0].Desc

$BtnSeleccionar.Add_Click({
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Filter = "Todos los archivos|*.*"
    if ($dialog.ShowDialog() -eq "OK") {
        Actualizar-Archivo $dialog.FileName
    }
})

$ZonaDrop.Add_DragEnter({
    param($s, $e)
    if ($e.Data.GetDataPresent([Windows.DataFormats]::FileDrop)) {
        $e.Effects = [Windows.DragDropEffects]::Copy
    }
})
$ZonaDrop.Add_Drop({
    param($s, $e)
    $archivos = $e.Data.GetData([Windows.DataFormats]::FileDrop)
    if ($archivos.Count -gt 0) {
        Actualizar-Archivo $archivos[0]
    }
})

$BtnFirmar.Add_Click({
    if (-not $script:rutaSeleccionada) { return }

    $BtnFirmar.IsEnabled = $false
    $BtnAbrirCarpeta.IsEnabled = $false
    $Progreso.Visibility = "Visible"
    $Progreso.IsIndeterminate = $true
    $TxtLog.Text = ""
    $TxtEstado.Text = "Procesando..."
    $window.Dispatcher.Invoke([action]{}, "Render")

    $workerElegido = $Workers[$ComboWorker.SelectedIndex].Nombre
    Agregar-Log "Archivo: $($script:rutaSeleccionada)"
    Agregar-Log "Worker: $workerElegido"
    Agregar-Log "Leyendo y codificando..."

    try {
        $bytes = [System.IO.File]::ReadAllBytes($script:rutaSeleccionada)
        $base64 = [Convert]::ToBase64String($bytes)
        $json = @{ data = $base64; encoding = "BASE64" } | ConvertTo-Json -Compress

        $payloadPath = [System.IO.Path]::GetTempFileName()
        [System.IO.File]::WriteAllText($payloadPath, $json)
        $respuestaPath = [System.IO.Path]::GetTempFileName()

        Agregar-Log "Enviando a http://${SignServerHost}:${Puerto}/signserver/rest/v1/workers/$workerElegido/process ..."

        $curlArgs = @(
            "--max-time", "180",
            "http://${SignServerHost}:${Puerto}/signserver/rest/v1/workers/$workerElegido/process",
            "-H", "Content-Type: application/json",
            "-H", "X-Keyfactor-Requested-With: X",
            "--data-binary", "@$payloadPath",
            "--output", $respuestaPath,
            "-s", "-w", "%{http_code}"
        )
        $codigoHttp = & curl.exe @curlArgs

        if ($codigoHttp -ne "200") {
            Agregar-Log "ERROR: HTTP $codigoHttp"
            $contenido = Get-Content $respuestaPath -Raw -ErrorAction SilentlyContinue
            if ($contenido) { Agregar-Log $contenido }
            $TxtEstado.Text = "Fallo. Revisa el log."
        }
        else {
            $respuesta = Get-Content $respuestaPath -Raw | ConvertFrom-Json
            if ($respuesta.error) {
                Agregar-Log "ERROR: $($respuesta.error)"
                $TxtEstado.Text = "Fallo. Revisa el log."
            }
            else {
                $dir = [System.IO.Path]::GetDirectoryName($script:rutaSeleccionada)
                $nombreBase = [System.IO.Path]::GetFileNameWithoutExtension($script:rutaSeleccionada)
                $ext = [System.IO.Path]::GetExtension($script:rutaSeleccionada)
                $salida = if ($workerElegido -eq "CMSSigner") { Join-Path $dir "$nombreBase.p7s" } else { Join-Path $dir "$nombreBase-firmado$ext" }
                [System.IO.File]::WriteAllBytes($salida, [Convert]::FromBase64String($respuesta.data))
                $script:rutaResultado = $salida
                Agregar-Log "OK. Guardado en: $salida"
                $TxtEstado.Text = "Firmado correctamente."
                $BtnAbrirCarpeta.IsEnabled = $true
            }
        }
        Remove-Item $payloadPath, $respuestaPath -ErrorAction SilentlyContinue
    }
    catch {
        Agregar-Log "EXCEPCION: $($_.Exception.Message)"
        $TxtEstado.Text = "Error inesperado."
    }
    finally {
        $Progreso.IsIndeterminate = $false
        $Progreso.Visibility = "Hidden"
        $BtnFirmar.IsEnabled = $true
    }
})

$BtnAbrirCarpeta.Add_Click({
    if ($script:rutaResultado) {
        Start-Process explorer.exe "/select,`"$script:rutaResultado`""
    }
})

[void]$window.ShowDialog()
