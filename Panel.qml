import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui

Panel {
  id: root
  moduleName: "tim.ring-cameras"
  ipcTarget: "tim.ring-cameras"
  manageIpc: false

  property bool daemonReachable: false
  property bool setupComplete: false
  property var cameras: []
  property string activeLiveView: ""

  property string historyOpenFor: ""
  property var historyByCamera: ({})
  property bool historyLoading: false

  property string linkStep: "form" // "form" | "2fa"
  property string linkEmail: ""
  property string linkPassword: ""
  property string link2faCode: ""
  property string link2faPrompt: ""

  property bool busy: false
  property string errorText: ""
  property string _actionOutput: ""
  property string _linkOutput: ""

  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property color urgent: bar ? bar.urgent : Color.urgent
  readonly property color dim: Qt.darker(foreground, 1.5)
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property color barIconColor: !daemonReachable ? urgent : (activeLiveView !== "" ? foreground : Qt.darker(barForeground, 1.3))

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  function runAction(cmd, payload, onDone, markBusy) {
    if (markBusy !== false) root.busy = true
    root.errorText = ""
    var args = ["omarchy-ring-cameras-ctl", cmd]
    if (payload !== undefined) args.push(JSON.stringify(payload))
    actionProcess.onDoneCallback = onDone
    actionProcess.command = args
    actionProcess.running = true
  }

  function refreshStatus() {
    runAction("status", undefined, function(res) {
      if (!res.ok) { root.daemonReachable = false; return }
      root.daemonReachable = true
      root.setupComplete = !!res.data.setupComplete
      root.activeLiveView = res.data.activeLiveView || ""
      // Recovers the 2FA step if the panel was closed and reopened mid-link
      // (e.g. after a Quickshell reload) — the daemon still remembers a
      // pending login even though this panel's local state was reset.
      if (!root.setupComplete && res.data.linkPending && root.linkStep === "form") {
        root.linkStep = "2fa"
        if (!root.link2faPrompt) root.link2faPrompt = "Enter the verification code Ring sent you."
      }
      if (root.setupComplete) root.refreshCameras()
    }, false)
  }

  function refreshCameras() {
    runAction("list_cameras", undefined, function(res) {
      if (res.ok) root.cameras = res.data.cameras || []
      else root.errorText = res.error
    }, false)
  }

  function startLive(cameraId) {
    runAction("live_view_start", { cameraId: cameraId }, function(res) {
      if (res.ok) root.activeLiveView = res.data.cameraId
      else root.errorText = res.error
    })
  }

  function stopLive() {
    runAction("live_view_stop", undefined, function(res) {
      root.activeLiveView = ""
    })
  }

  function snapshot(cameraId) {
    runAction("snapshot", { cameraId: cameraId }, function(res) {
      if (res.ok) {
        openProcess.command = ["xdg-open", res.data.path]
        openProcess.running = true
      } else {
        root.errorText = res.error
      }
    })
  }

  function toggleHistory(cameraId) {
    if (root.historyOpenFor === cameraId) {
      root.historyOpenFor = ""
      return
    }
    root.historyOpenFor = cameraId
    root.loadHistory(cameraId)
  }

  function loadHistory(cameraId) {
    root.historyLoading = true
    runAction("history", { cameraId: cameraId, hours: 48 }, function(res) {
      root.historyLoading = false
      if (res.ok) {
        // A genuinely new object, not the same reference mutated in place —
        // QML's change notification compares by reference, so reassigning
        // the identical object silently fails to notify any binding that
        // reads historyByCamera (this was the actual bug: the debug counter
        // stayed frozen at count=0 even after a successful, verified fetch).
        var byCamera = Object.assign({}, root.historyByCamera)
        byCamera[cameraId] = res.data.events || []
        root.historyByCamera = byCamera
      } else {
        root.errorText = res.error
      }
    }, false)
  }

  function playRecording(url) {
    // Playback URLs are presigned and expire in ~15 minutes (Ring sets
    // X-Amz-Expires=900) — fine for "click it while the list is open," not
    // meant to be cached for later.
    runAction("play_recording", { url: url }, function(res) {
      if (!res.ok) root.errorText = res.error
    })
  }

  function historyEventLabel(kind) {
    if (kind === "motion") return "Motion"
    if (kind === "on_demand") return "On-demand"
    if (kind === "ding") return "Ding"
    if (kind === "alarm") return "Alarm"
    return kind
  }

  function hasHistoryLoaded(cameraId) {
    return Array.isArray(root.historyByCamera[cameraId])
  }

  // Email/password/2FA code go over the child's stdin via ctl.mjs --stdin,
  // never argv — argv is readable by any other process on this machine via
  // /proc/<pid>/cmdline for as long as the short-lived ctl.mjs is alive.
  function runSecureAction(cmd, payload, onDone) {
    root.busy = true
    root.errorText = ""
    linkProcess.onDoneCallback = onDone
    linkProcess.pendingPayload = JSON.stringify(payload)
    linkProcess.command = ["omarchy-ring-cameras-ctl", cmd, "--stdin"]
    linkProcess.running = true
  }

  function submitLink() {
    if (root.linkEmail.length === 0 || root.linkPassword.length === 0) {
      root.errorText = "Email and password required."
      return
    }
    runSecureAction("link_start", { email: root.linkEmail, password: root.linkPassword }, function(res) {
      root.linkPassword = ""
      if (!res.ok) { root.errorText = res.error; return }
      if (res.data.status === "needs_2fa") {
        root.link2faPrompt = res.data.prompt || "Enter the verification code Ring sent you."
        root.linkStep = "2fa"
      } else if (res.data.status === "linked") {
        root.linkEmail = ""
        root.linkStep = "form"
        root.refreshStatus()
      }
    })
  }

  function submit2fa() {
    if (root.link2faCode.length === 0) {
      root.errorText = "Enter the code."
      return
    }
    runSecureAction("link_2fa", { code: root.link2faCode }, function(res) {
      if (!res.ok) { root.errorText = res.error; return }
      if (res.data.status === "needs_2fa") {
        root.link2faPrompt = res.data.prompt
        root.link2faCode = ""
      } else if (res.data.status === "linked") {
        root.linkEmail = ""
        root.link2faCode = ""
        root.linkStep = "form"
        root.refreshStatus()
      }
    })
  }

  function cancelLink() {
    runSecureAction("link_cancel", {}, function(res) {
      root.linkStep = "form"
      root.link2faCode = ""
      root.link2faPrompt = ""
      root.errorText = ""
    })
  }

  onOpenedChanged: if (opened) { root.errorText = ""; root.refreshStatus() }

  Component.onCompleted: root.refreshStatus()

  Process {
    id: actionProcess
    property var onDoneCallback: null
    running: false
    command: []
    stdout: StdioCollector {
      id: actionStdout
      waitForEnd: true
      onStreamFinished: root._actionOutput = text
    }
    onExited: function(exitCode) {
      root.busy = false
      var response = null
      try { response = JSON.parse(String(root._actionOutput || "")) } catch (e) { response = null }
      if (!response) response = { ok: false, error: "camera daemon unreachable" }
      var cb = actionProcess.onDoneCallback
      actionProcess.onDoneCallback = null
      if (cb) cb(response)
    }
  }

  Process {
    id: openProcess
    running: false
    command: []
  }

  Process {
    id: linkProcess
    property var onDoneCallback: null
    property string pendingPayload: ""
    running: false
    command: []
    stdinEnabled: true
    onStarted: {
      write(linkProcess.pendingPayload + "\n")
      linkProcess.pendingPayload = ""
    }
    stdout: StdioCollector {
      id: linkStdout
      waitForEnd: true
      onStreamFinished: root._linkOutput = text
    }
    onExited: function(exitCode) {
      root.busy = false
      var response = null
      try { response = JSON.parse(String(root._linkOutput || "")) } catch (e) { response = null }
      if (!response) response = { ok: false, error: "camera daemon unreachable" }
      var cb = linkProcess.onDoneCallback
      linkProcess.onDoneCallback = null
      if (cb) cb(response)
    }
  }

  Timer {
    interval: Math.max(10, root.setting("pollIntervalSec", 30)) * 1000
    running: true
    repeat: true
    onTriggered: if (!root.opened) root.refreshStatus()
  }

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    iconComponent: Component {
      Item {
        CameraIcon {
          anchors.centerIn: parent
          iconSize: Style.space(11)
          color: root.barIconColor
          active: root.activeLiveView !== ""
        }
      }
    }
    onPressed: function(buttonCode) { root.toggle() }
  }

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: escCatcher
    contentWidth: panel.fittedContentWidth(Style.space(360))
    contentHeight: panel.fittedContentHeight(column.implicitHeight, Style.space(560))

    Item {
      id: escCatcher
      anchors.fill: parent
      focus: true
      Keys.onEscapePressed: root.close()

      Flickable {
        id: panelFlick
        anchors.fill: parent
        contentWidth: width
        contentHeight: column.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        flickableDirection: Flickable.VerticalFlick
        interactive: contentHeight > height
        ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

        Column {
          id: column
          width: panelFlick.width
          spacing: Style.space(12)

          PanelHero {
            width: parent.width
            title: "Ring Cameras"
            meta: !root.daemonReachable ? "Camera daemon unreachable"
              : !root.setupComplete ? "Not linked to a Ring account"
              : root.activeLiveView !== "" ? "Live view playing"
              : root.cameras.length + " camera" + (root.cameras.length === 1 ? "" : "s")
            foreground: root.foreground
            fontFamily: root.fontFamily
            trailingControl: root.activeLiveView !== "" ? stopLiveButton : null
          }

          Component {
            id: stopLiveButton
            Button {
              text: "Stop"
              foreground: root.foreground
              bordered: true
              onClicked: root.stopLive()
            }
          }

          Text {
            visible: root.errorText !== ""
            width: parent.width
            text: root.errorText
            color: root.urgent
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
            wrapMode: Text.WordWrap
          }

          // --- Not linked yet: email/password form -----------------------
          Column {
            visible: root.daemonReachable && !root.setupComplete && root.linkStep === "form"
            width: parent.width
            spacing: Style.space(8)

            Text {
              width: parent.width
              text: "Link your Ring account. This talks to Ring directly from the local daemon — nothing goes through any third party."
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.bodySmall
              wrapMode: Text.WordWrap
            }

            TextField {
              width: parent.width
              placeholderText: "Ring email"
              foreground: root.foreground
              text: root.linkEmail
              onTextChanged: root.linkEmail = text
            }

            TextField {
              width: parent.width
              password: true
              placeholderText: "Ring password"
              foreground: root.foreground
              text: root.linkPassword
              onTextChanged: root.linkPassword = text
              Keys.onReturnPressed: root.submitLink()
            }

            Button {
              text: root.busy ? "Linking…" : "Link account"
              foreground: root.foreground
              bordered: true
              enabled: !root.busy && root.linkEmail.length > 0 && root.linkPassword.length > 0
              onClicked: root.submitLink()
            }
          }

          // --- Not linked yet: 2FA step ------------------------------------
          Column {
            visible: root.daemonReachable && !root.setupComplete && root.linkStep === "2fa"
            width: parent.width
            spacing: Style.space(8)

            Text {
              width: parent.width
              text: root.link2faPrompt
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.bodySmall
              wrapMode: Text.WordWrap
            }

            TextField {
              width: parent.width
              placeholderText: "Verification code"
              foreground: root.foreground
              text: root.link2faCode
              onTextChanged: root.link2faCode = text
              Keys.onReturnPressed: root.submit2fa()
            }

            Row {
              spacing: Style.space(6)
              Button {
                text: root.busy ? "Verifying…" : "Verify"
                foreground: root.foreground
                bordered: true
                enabled: !root.busy && root.link2faCode.length > 0
                onClicked: root.submit2fa()
              }
              Button {
                text: "Cancel"
                foreground: root.urgent
                bordered: true
                enabled: !root.busy
                onClicked: root.cancelLink()
              }
            }
          }

          // --- Camera list -------------------------------------------------
          Column {
            visible: root.setupComplete && root.cameras.length > 0
            width: parent.width
            spacing: Style.space(10)

            Repeater {
              model: root.cameras
              delegate: Column {
                required property var modelData
                width: column.width
                spacing: Style.space(4)

                Text {
                  width: parent.width
                  text: modelData.name
                    + (modelData.isOffline ? "  ·  offline" : "")
                    + (modelData.batteryLevel !== null && modelData.batteryLevel !== undefined ? "  ·  " + modelData.batteryLevel + "%" : "")
                  color: modelData.isOffline ? root.dim : root.foreground
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.body
                  elide: Text.ElideRight
                }

                Flow {
                  width: parent.width
                  spacing: Style.space(6)
                  Button {
                    text: root.activeLiveView === modelData.id ? "Stop" : "Live view"
                    foreground: root.foreground
                    bordered: true
                    enabled: !modelData.isOffline
                    onClicked: root.activeLiveView === modelData.id ? root.stopLive() : root.startLive(modelData.id)
                  }
                  Button {
                    text: "Snapshot"
                    foreground: root.foreground
                    bordered: true
                    enabled: !modelData.isOffline
                    onClicked: root.snapshot(modelData.id)
                  }
                  Button {
                    text: root.historyOpenFor === modelData.id ? "Hide history" : "History"
                    foreground: root.foreground
                    bordered: true
                    onClicked: root.toggleHistory(modelData.id)
                  }
                }

                // --- History: recent clips for this camera ------------------
                Column {
                  visible: root.historyOpenFor === modelData.id
                  width: parent.width
                  spacing: Style.space(4)

                  Item { width: 1; height: Style.space(4) }

                  Text {
                    visible: root.historyLoading && !root.hasHistoryLoaded(modelData.id)
                    text: "Loading…"
                    color: root.dim
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.bodySmall
                  }

                  Text {
                    visible: !root.historyLoading && root.hasHistoryLoaded(modelData.id) && root.historyByCamera[modelData.id].length === 0
                    text: "No recent events (last 48 hours)."
                    color: root.dim
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.bodySmall
                  }

                  Repeater {
                    model: root.historyByCamera[modelData.id] || []
                    delegate: Row {
                      required property var modelData
                      width: column.width
                      spacing: Style.space(8)

                      Text {
                        width: parent.width - playButton.width - Style.space(8)
                        text: root.historyEventLabel(modelData.kind) + "  ·  "
                          + Qt.formatDateTime(new Date(modelData.createdAt), "MMM d, h:mm AP")
                          + "  ·  " + modelData.duration + "s"
                        color: root.dim
                        font.family: root.fontFamily
                        font.pixelSize: Style.font.bodySmall
                        elide: Text.ElideRight
                      }

                      Button {
                        id: playButton
                        text: "Play"
                        foreground: root.foreground
                        bordered: true
                        onClicked: root.playRecording(modelData.url)
                      }
                    }
                  }
                }
              }
            }
          }

          Text {
            visible: root.setupComplete && root.cameras.length === 0 && root.daemonReachable
            width: parent.width
            text: "No cameras found on this Ring account."
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
            wrapMode: Text.WordWrap
          }
        }
      }
    }
  }
}
