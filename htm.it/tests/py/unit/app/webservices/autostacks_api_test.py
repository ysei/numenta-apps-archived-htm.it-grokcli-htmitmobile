#!/usr/bin/env python
# ----------------------------------------------------------------------
# Numenta Platform for Intelligent Computing (NuPIC)
# Copyright (C) 2015, Numenta, Inc.  Unless you have purchased from
# Numenta, Inc. a separate commercial license for this software code, the
# following terms and conditions apply:
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero Public License version 3 as
# published by the Free Software Foundation.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
# See the GNU Affero Public License for more details.
#
# You should have received a copy of the GNU Affero Public License
# along with this program.  If not, see http://www.gnu.org/licenses.
#
# http://numenta.org/licenses/
# ----------------------------------------------------------------------

# Disable warning: access to protected member
# pylint: disable=W0212

import os
import datetime
import json
import unittest

from paste.fixture import TestApp, AppError
from mock import ANY, patch, Mock


from htm.it import logging_support
import htm.it.app
from htmengine import utils as app_utils
from htmengine.utils import jsonDecode, jsonEncode
from htm.it.app.exceptions import (DuplicateRecordError,
                                 QuotaError)
from htm.it.app.webservices import autostacks_api, models_api
from htm.it.test_utils.app.webservices import getDefaultHTTPHeaders
from htm.it.app.runtime.aggregator_instances import InstanceInfo



def setUpModule():
  logging_support.LoggingSupport.initTestApp()


@patch("htm.it.app.webservices.repository")
class TestAutostacksHandler(unittest.TestCase):

  @classmethod
  def setUpClass(cls):
    cls.autostack = Mock(uid="blahblahblah",
                         region="bogus",
                         filters=jsonEncode({"tag:Name":["Bogus"]}))
    cls.autostack.name = "Test"

    cls.jsonAutostack = jsonEncode({"uid":"blahblahblah",
                                    "name":"Test",
                                    "region":"bogus",
                                    "filters":{"tag:Name":["Bogus"]}})

  def setUp(self):
    self.headers = getDefaultHTTPHeaders(htm.it.app.config)
    self.app = TestApp(autostacks_api.app.wsgifunc())


  @patch("htm.it.app.webservices.autostacks_api.repository")
  def testGETAutostacks(self, repositoryMock, *_args):
    """ Test GETing all autostacks from autostacks API
    """

    repositoryMock.getAutostackList.return_value = [self.autostack]
    response = self.app.get("/", headers=self.headers)

    self.assertEqual(response.status, 200)
    result = json.loads(response.body)


    self.assertDictEqual(json.loads(self.jsonAutostack), result[0])

  @patch("htm.it.app.quota.repository")
  @patch("htm.it.app.webservices.autostacks_api.createAutostackDatasourceAdapter")
  def testPOSTAutostacksQuota(self, adapterMock, quotaRepositoryMock,
                              _repositoryMock):
    quotaRepositoryMock.getInstanceCount.return_value = 0

    adapterMock.return_value.createAutostack.side_effect = QuotaError()

    with self.assertRaises(AppError) as e:
      self.app.post("/", self.jsonAutostack, headers=self.headers)

    self.assertIn("Bad response: 403 Forbidden", str(e.exception))
    self.assertTrue(adapterMock.return_value.createAutostack.called)


  @patch("htm.it.app.quota.repository")
  @patch("htm.it.app.webservices.autostacks_api.createAutostackDatasourceAdapter")
  def testPOSTAutostacks(self, adapterMock, quotaRepositoryMock,
                         _repositoryMock):
    name = "Test"
    region = "Bogus"
    filters = {"tag:Name":["Bogus"]}

    quotaRepositoryMock.getInstanceCount.return_value = 0

    autostackMock = Mock()
    autostackMock.items.return_value = [("name", name),
                                       ("region", region),
                                       ("filters", filters)]
    adapterMock.return_value.createAutostack.return_value = autostackMock

    response = self.app.post("/",
                             app_utils.jsonEncode({"name": name,
                                                   "region": region,
                                                   "filters": filters}),
                             headers=self.headers)

    self.assertEqual(response.status, 201)
    result = json.loads(response.body)
    self.assertEqual(result["name"], "Test")

    self.assertTrue(adapterMock.return_value.createAutostack.called)


  @patch("htm.it.app.webservices.autostacks_api.createAutostackDatasourceAdapter")
  def testPOSTAutostacksNameInUse(self, createAutostackMock, _repositoryMock):
    createAutostackMock.side_effect = DuplicateRecordError
    with self.assertRaises(AppError) as cm:
      self.app.post("/", app_utils.jsonEncode({"name": "Test",
                                               "region": "Bogus",
                                               "filters": (
                                                   {"tag:Name":["Bogus"]})}),
                    headers=self.headers)
    self.assertIn("The name you are trying to use, 'Test', is already in use "
                  "in AWS region 'Bogus'. Please enter a unique Autostack "
                  "name.", cm.exception.message)



@patch("htm.it.app.webservices.repository")
class TestAutostackHandler(unittest.TestCase):

  @classmethod
  def setUpClass(cls):
    cls.autostack = Mock(uid="blahblahblah",
                         region="bogus",
                         filters=jsonEncode({"tag:Name":["Bogus"]}))
    cls.autostack.name = "Test"

    cls.jsonAutostack = jsonEncode({"uid":"blahblahblah",
                                    "name":"Test",
                                    "region":"bogus",
                                    "filters":{"tag:Name":["Bogus"]}})


  def setUp(self):
    self.headers = getDefaultHTTPHeaders(htm.it.app.config)
    self.app = TestApp(autostacks_api.app.wsgifunc())


  @patch("htm.it.app.webservices.autostacks_api.repository")
  def testDELETEAutostackWithoutModels(self, repositoryMock, *_args):
    autostack = Mock(uid="xyz",
                     name="Test",
                     region="Bogus",
                     filters={"tag:Name": ["Bogus"]})
    repositoryMock.getAutostackMetrics.return_value = iter([])

    response = self.app.delete("/" + autostack.uid,
                               headers=self.headers)

    self.assertEqual(response.status, 204)
    self.assertTrue(repositoryMock.deleteAutostack.called)
    repositoryMock.deleteAutostack.assert_called_with(ANY, autostack.uid)


  @patch("htm.it.app.webservices.autostacks_api.repository")
  @patch("htmengine.model_swapper.utils.deleteHTMModel", autospec=True)
  def testDELETEAutostackWithModels(self,
                                    _deleteHTMModelMock,
                                    repositoryMock,
                                    *_args):
    autostack = Mock(uid="xyz",
                     name="Test",
                     region="Bogus",
                     filters={"tag:Name": ["Bogus"]})
    metricMock = Mock(uid="abc")
    repositoryMock.getAutostackMetrics.return_value = iter([metricMock])
    response = self.app.delete("/" + autostack.uid,
                               headers=self.headers)
    self.assertEqual(response.status, 204)
    self.assertTrue(repositoryMock.deleteAutostack)
    repositoryMock.deleteAutostack.assert_called_with(ANY, autostack.uid)


@patch("htm.it.app.webservices.repository")
class TestAutostackInstancesHandler(unittest.TestCase):
  def setUp(self):
    self.headers = getDefaultHTTPHeaders(htm.it.app.config)
    self.app = TestApp(autostacks_api.app.wsgifunc())


  @patch(
    "htm.it.app.webservices.autostacks_api.createCloudwatchDatasourceAdapter")
  def testAutostackInstancesPreview(self,
                                    adapterMock,
                                    _repositoryMock):
    adapterMock.return_value.getMatchingResources.return_value = (
      [
        InstanceInfo(
          instanceID="i-ab15a19d",
          regionName="Bogus",
          state="running",
          stateCode=16,
          instanceType="m1.large",
          launchTime=datetime.datetime(2013, 12, 19, 12, 2, 31),
          tags={
            "Type": "Jenkins",
            "Name": "Bogus",
            "Description": "Jenkin Main(Python 2.7)"
          }
        )
      ]
    )
    response = self.app.get(
      '/preview_instances?region=Bogus&filters={"tag:Name":["Bogus"]}',
      headers=self.headers)

    instance = app_utils.jsonDecode(response.body)[0]
    self.assertIn("instanceID", instance)
    self.assertEqual(instance["instanceID"], "i-ab15a19d")
    self.assertIn("state", instance)
    self.assertEqual(instance["state"], "running")
    self.assertIn("regionName", instance)
    self.assertEqual(instance["regionName"], "Bogus")
    self.assertIn("instanceType", instance)
    self.assertEqual(instance["instanceType"], "m1.large")
    self.assertIn("launchTime", instance)
    self.assertEqual(instance["launchTime"], "2013-12-19T12:02:31Z")
    self.assertIn("tags", instance)
    self.assertDictEqual(instance["tags"], {"Type": "Jenkins",
                                            "Name": "Bogus",
                                            "Description": (
                                              "Jenkin Main(Python 2.7)")})


  @patch(
    "htm.it.app.webservices.autostacks_api.createCloudwatchDatasourceAdapter")
  def testAutostackInstancesKnown(self, adapterMock, repositoryMock, *args):
    adapterMock.return_value.getMatchingResources.return_value = (
      [
        InstanceInfo(
          instanceID="i-ab15a19d",
          regionName="Bogus",
          state="running",
          stateCode=16,
          instanceType="m1.large",
          launchTime=datetime.datetime(2013, 12, 19, 12, 2, 31),
          tags={
            "Type": "Jenkins",
            "Name": "Bogus",
            "Description": "Jenkin Main(Python 2.7)"
          }
        )
      ]
    )
    repositoryMock.getAutostack.return_value = Mock(name="Test",
                                                    region="Bogus",
                                                    filters={"tag:Name":
                                                             ["Bogus"]})
    response = self.app.get('/28bc7c68a05049b98a2952fa0c3e23ee/instances',
                            headers=self.headers)
    instance = app_utils.jsonDecode(response.body)[0]
    self.assertIn("instanceID", instance)
    self.assertEqual(instance["instanceID"], "i-ab15a19d")
    self.assertIn("state", instance)
    self.assertEqual(instance["state"], "running")
    self.assertIn("regionName", instance)
    self.assertEqual(instance["regionName"], "Bogus")
    self.assertIn("instanceType", instance)
    self.assertEqual(instance["instanceType"], "m1.large")
    self.assertIn("launchTime", instance)
    self.assertEqual(instance["launchTime"], "2013-12-19T12:02:31Z")
    self.assertIn("tags", instance)
    self.assertDictEqual(instance["tags"], {"Type": "Jenkins",
                                            "Name": "Bogus",
                                            "Description": (
                                              "Jenkin Main(Python 2.7)")})



@patch("htm.it.app.webservices.repository")
class TestAutostackMetricsHandler(unittest.TestCase):

  @classmethod
  def setUpClass(cls):
    with open(
        os.path.join(
          htm.it.app.HTM_IT_HOME,
          "tests/py/data/app/webservices/models_list.json")) as fileObj:
      cls.model_list = json.load(fileObj)

    cls.autostack = Mock(uid="blahblahblah",
                         region="bogus",
                         filters=jsonEncode({"tag:Name":["Bogus"]}))
    cls.autostack.name = "Test"

    cls.jsonAutostack = jsonEncode({"uid":"blahblahblah",
                                    "name":"Test",
                                    "region":"bogus",
                                    "filters":{"tag:Name":["Bogus"]}})
    cls.metric = Mock(uid="cebe9fab-f416-4845-8dab-02d292244112",
                      datasource="autostack",
                      description="The number of database connections in use "
                                  "by Amazon RDS database",
                      server="htm-itdb2",
                      location="us-east-1",
                      parameters=jsonEncode(
                        {"region":"us-east-1",
                         "DBInstanceIdentifier":"htm-itdb2"}),
                      status=1,
                      message=None,
                      collector_error=None,
                      last_timestamp="2013-08-15 21:25:00",
                      poll_interval=60,
                      tag_name=None,
                      model_params=None,
                      last_rowid=20277)
    cls.metric.name = "AWS/RDS/DatabaseConnections"

    cls.jsonMetric = jsonEncode(
      {"uid":cls.metric.uid,
       "datasource":cls.metric.datasource,
       "name":cls.metric.name,
       "description":cls.metric.description,
       "server":cls.metric.server,
       "location":cls.metric.location,
       "parameters":jsonDecode(cls.metric.parameters),
       "status":cls.metric.status,
       "message":cls.metric.message,
       "last_timestamp":cls.metric.last_timestamp,
       "poll_interval":cls.metric.poll_interval,
       "tag_name":cls.metric.tag_name,
       "last_rowid":cls.metric.last_rowid,
       "display_name":cls.metric.server})

  def setUp(self):
    self.headers = getDefaultHTTPHeaders(htm.it.app.config)
    self.app = TestApp(autostacks_api.app.wsgifunc())


  @patch("htm.it.app.webservices.autostacks_api.repository")
  def testGETAutostackMetrics(self, repositoryMock, *_args):
    repositoryMock.getAutostackMetrics.return_value = iter([self.metric])
    response = self.app.get(
      "/" + self.autostack.uid + "/metrics", headers=self.headers)
    self.assertEqual(response.status, 200)
    result = json.loads(response.body)
    self.assertDictEqual(json.loads(self.jsonMetric), result[0])


  @patch("htm.it.app.webservices.autostacks_api.createAutostackDatasourceAdapter")
  @patch("htm.it.app.repository.getMetric", autospec=True)
  @patch("htm.it.app.repository.addMetric", autospec=True)
  def testPOSTAutostackMetricsNoMinMax(
        self,
        addMetricMock,
        getMetricMock,
        adapterMock,
        *_args):

    getMetricMock.return_value = self.metric
    addMetricMock.return_value = self.metric

    response = self.app.post("/" + self.autostack.uid + "/metrics",
                             app_utils.jsonEncode([{"metric": "CPUUtilization",
                                                    "namespace": "AWS/EC2"},
                                                   {"metric": "NetworkIn",
                                                    "namespace": "AWS/EC2"}]),
                             headers=self.headers)
    self.assertEqual(response.status, 201)
    self.assertEqual(adapterMock.return_value.monitorMetric.call_count, 2)

    metricSpec = (
      adapterMock.return_value.monitorMetric
      .call_args_list[0][0][0]["metricSpec"])
    self.assertEqual(metricSpec["subordinateMetric"]["metric"], "CPUUtilization")
    self.assertEqual(metricSpec["subordinateMetric"]["namespace"], "AWS/EC2")

    metricSpec = (
      adapterMock.return_value.monitorMetric
      .call_args_list[1][0][0]["metricSpec"])
    self.assertEqual(metricSpec["subordinateMetric"]["metric"], "NetworkIn")
    self.assertEqual(metricSpec["subordinateMetric"]["namespace"], "AWS/EC2")



  @patch("htm.it.app.webservices.autostacks_api.createAutostackDatasourceAdapter")
  @patch("htm.it.app.repository.getMetric", autospec=True)
  @patch("htm.it.app.repository.addMetric", autospec=True)
  def testPOSTAutostackMetricsWithMinMax(
      self,
      addMetricMock,
      getMetricMock,
      adapterMock,
      *_args):

    getMetricMock.return_value = self.metric
    addMetricMock.return_value = self.metric

    response = self.app.post("/" + self.autostack.uid + "/metrics",
                             app_utils.jsonEncode([{"metric": "CPUUtilization",
                                                    "namespace": "AWS/EC2",
                                                    "min": 0.0, "max": 10.0}]),
                             headers=self.headers)
    self.assertEqual(response.status, 201)
    self.assertTrue(adapterMock.return_value.monitorMetric.called)
    self.assertEqual(
      adapterMock.return_value.monitorMetric
      .call_args_list[0][0][0]["modelParams"],
      {'max': 10.0, 'min': 0.0})


  @patch("htm.it.app.webservices.autostacks_api.createAutostackDatasourceAdapter")
  @patch("htm.it.app.webservices.models_api.repository.getAutostack")
  def testPOSTAutostackMetricsHandlesObjectNotFoundError(
      self,
      autostackGetMock,
      adapterMock,
      _repositoryMock):
    autostackGetMock.return_value = self.autostack
    adapterMock.return_value.monitorMetric.side_effect = (
      ValueError("Autostack not found."))

    with self.assertRaises(AppError) as e:
      self.app.post("/" + self.autostack.uid + "/metrics",
                    app_utils.jsonEncode(
                      [{"metric": "Foobar",
                        "namespace": "AWS/EC2"}]),
                    headers=self.headers)

    self.assertIn("400 Bad Request", str(e.exception))
    self.assertTrue(adapterMock.return_value.monitorMetric.called)


  @patch("htmengine.model_swapper.utils.deleteHTMModel")
  @patch("htm.it.app.webservices.autostacks_api.repository")
  def testDELETEAutostackMetrics(self, repositoryMock, deleteHTMModelMock,
                                 *_args):
    repositoryMock.getAutostackFromMetric.return_value = Mock(
      uid=self.autostack.uid)
    response = self.app.delete(
      "/" + self.autostack.uid + "/metrics/" + self.metric.uid,
      headers=self.headers)
    self.assertEqual(response.status, 204)
    self.assertTrue(repositoryMock.deleteMetric.called)
    repositoryMock.deleteMetric.assert_called_with(ANY, self.metric.uid)
    deleteHTMModelMock.assert_called_once_with(self.metric.uid)


  @patch("htmengine.model_swapper.utils.deleteHTMModel",
         auto_spec=True)
  @patch("htm.it.app.webservices.autostacks_api.repository",
         auto_spec=True)
  def testDELETEAutostackMetricsWrongAutostack(self, repositoryMock,
                                               *_args):
    repositoryMock.getAutostackFromMetric.return_value = Mock(
      uid="wrong-autostack-id")
    with self.assertRaises(AppError) as cm:
      self.app.delete(
        "/" + self.autostack.uid + "/metrics/" + self.metric.uid,
        headers=self.headers)
    self.assertIn("Bad response: 400 Bad Request", str(cm.exception))
    self.assertIn(
      "Metric=cebe9fab-f416-4845-8dab-02d292244112 does not belong to "
      "autostack=blahblahblah", str(cm.exception))


  @patch("htm.it.app.webservices.models_api.repository")
  def testDELETEAutostackMetricsFromModelsAPI(self, repositoryMock, *_args):
    repositoryMock.getMetric.return_value = self.metric

    app = TestApp(models_api.app.wsgifunc())

    with self.assertRaises(AppError) as e:
      app.delete("/" + self.metric.uid, headers=self.headers)

    self.assertIn("Bad response: 405 Method Not Allowed", str(e.exception))



if __name__ == "__main__":
  unittest.main()
